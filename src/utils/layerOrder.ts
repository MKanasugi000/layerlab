import type { Layer, LayerId } from '../types';

/**
 * レイヤー並び替えの中核ロジック（純関数・副作用なし・store 非依存）。
 *
 * ## 不変条件（canonical form）
 * `layers` はフラット配列だが、**pre-order**（group の直後にその子孫が連続して並ぶ）を
 * 正準形とする。ツリー表示（parentId 階層）はこの配列の射影にすぎない。
 * z-order は「配列位置のみ」で決まり **layers[0] が最前面**（Canvas は
 * `[...layers].reverse()` して描画）。group 自体は描画されず、配列位置は
 * 「子をどこに連れて行くか」を決めるだけ。
 *
 * この不変条件を破ると「パネルの見た目」と「実際の描画順」が乖離する。
 * DnD/グループ化/複製など配列を触る全操作は最後に {@link normalizeLayerOrder} を
 * 通して正準形へ戻すこと。
 */

/** レイヤー並び替えのドロップ先。 */
export type DropTarget =
  | { kind: 'before'; refId: LayerId } // ref の直前（＝ref より前面）へ
  | { kind: 'after'; refId: LayerId } //  ref の直後（＝ref より背面）へ
  | { kind: 'into'; groupId: LayerId }; // group の先頭子として

/** 存在しない parentId は root(null) 扱いへ丸める。 */
function parentKey(l: Layer, ids: Set<LayerId>): LayerId | null {
  return l.parentId && ids.has(l.parentId) ? l.parentId : null;
}

/**
 * parentId の循環を入力順に基づいて決定的に切断する。
 *
 * 各連結成分は「子→親」の辺を最大1本しか持たないため、循環ごとに1本だけ切ればよい。
 * 循環に含まれるうち元配列で最も前にあるレイヤーを root に昇格することで、同じ入力は
 * 常に同じ修復結果になる。正常な入力では元配列そのものを返し、修復時も切断対象だけを
 * 浅く複製するため、呼び出し元のデータは変更しない。
 */
export function breakParentCycles(layers: Layer[]): Layer[] {
  if (layers.length === 0) return layers;

  // 重複 id 自体は別の形式エラーだが、ここでは最初の要素を代表として決定的に扱う。
  const byId = new Map<LayerId, Layer>();
  const indexById = new Map<LayerId, number>();
  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index];
    if (byId.has(layer.id)) continue;
    byId.set(layer.id, layer);
    indexById.set(layer.id, index);
  }

  const done = new Set<LayerId>();
  let repaired: Layer[] | null = null;

  const detach = (id: LayerId) => {
    const index = indexById.get(id);
    if (index === undefined) return;
    if (!repaired) repaired = [...layers];
    const replacement = { ...repaired[index], parentId: null } as Layer;
    repaired[index] = replacement;
    byId.set(id, replacement);
  };

  // 再帰を使わず親チェーンを辿る。壊れた巨大ファイルでもJSコールスタックを消費しない。
  for (const startId of byId.keys()) {
    if (done.has(startId)) continue;
    const path: LayerId[] = [];
    const position = new Map<LayerId, number>();
    let currentId: LayerId | null = startId;

    while (currentId && byId.has(currentId) && !done.has(currentId)) {
      const cycleStart = position.get(currentId);
      if (cycleStart !== undefined) {
        const cycle = path.slice(cycleStart);
        let detachId = cycle[0];
        for (const candidate of cycle.slice(1)) {
          if (indexById.get(candidate)! < indexById.get(detachId)!) {
            detachId = candidate;
          }
        }
        detach(detachId);
        break;
      }

      position.set(currentId, path.length);
      path.push(currentId);
      const parentId: LayerId | null | undefined = byId.get(currentId)?.parentId;
      currentId = parentId && byId.has(parentId) ? parentId : null;
    }
    for (const id of path) done.add(id);
  }
  return repaired ?? layers;
}

/** 親 id → 直下の子レイヤー（元配列の相対順序を保持）。 */
export function childrenByParent(layers: Layer[]): Map<LayerId | null, Layer[]> {
  const ids = new Set(layers.map((l) => l.id));
  const map = new Map<LayerId | null, Layer[]>();
  for (const l of layers) {
    const k = parentKey(l, ids);
    const arr = map.get(k);
    if (arr) arr.push(l);
    else map.set(k, [l]);
  }
  return map;
}

/**
 * フラット配列を pre-order（group 直後に子孫が連続）へ正規化する。
 * 各親の子リスト内の相対順序は保持し、冪等（既に正準形なら順序不変）。
 * 非 group を親にした壊れた階層など、rootから到達不能なレイヤーも末尾へ退避して全件残す。
 */
export function normalizeLayerOrder(layers: Layer[]): Layer[] {
  const safeLayers = breakParentCycles(layers);
  const byParent = childrenByParent(safeLayers);
  const out: Layer[] = [];
  const seen = new Set<LayerId>();
  const walk = (parent: LayerId | null) => {
    for (const l of byParent.get(parent) ?? []) {
      if (seen.has(l.id)) continue; // 循環保険
      seen.add(l.id);
      out.push(l);
      if (l.type === 'group') walk(l.id);
    }
  };
  walk(null);
  if (out.length !== safeLayers.length) {
    for (const l of safeLayers) if (!seen.has(l.id)) out.push(l);
  }
  return out;
}

/**
 * 名前フィルタで表示すべき id 集合（一致レイヤー＋その祖先グループ＝文脈維持）。
 * query が空なら null（＝全表示）。純関数。
 */
export function matchFilter(layers: Layer[], query: string): Set<LayerId> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const byId = new Map(layers.map((l) => [l.id, l] as const));
  const keep = new Set<LayerId>();
  for (const l of layers) {
    if (!l.name.toLowerCase().includes(q)) continue;
    keep.add(l.id);
    let pid = l.parentId ?? null;
    const guard = new Set<LayerId>();
    while (pid && byId.has(pid) && !guard.has(pid)) {
      keep.add(pid);
      guard.add(pid);
      pid = byId.get(pid)!.parentId ?? null;
    }
  }
  return keep;
}

/** id の全子孫 id（自身は含まない）。 */
export function collectDescendants(layers: Layer[], id: LayerId): Set<LayerId> {
  const byParent = childrenByParent(layers);
  const out = new Set<LayerId>();
  const walk = (pid: LayerId) => {
    for (const c of byParent.get(pid) ?? []) {
      if (out.has(c.id)) continue;
      out.add(c.id);
      if (c.type === 'group') walk(c.id);
    }
  };
  walk(id);
  return out;
}

/**
 * ids のうち「祖先も ids に含まれている」ものを除いた最上位の代表だけを返す。
 * 元配列順を保持。group とその子を同時選択したときに、子まで二重に動かさないための土台。
 */
export function topLevelReps(layers: Layer[], ids: LayerId[]): LayerId[] {
  const idSet = new Set(layers.map((l) => l.id));
  const set = new Set(ids.filter((id) => idSet.has(id)));
  const byId = new Map(layers.map((l) => [l.id, l] as const));
  const hasSelectedAncestor = (id: LayerId): boolean => {
    let pid = byId.get(id)?.parentId ?? null;
    const guard = new Set<LayerId>();
    while (pid && idSet.has(pid) && !guard.has(pid)) {
      if (set.has(pid)) return true;
      guard.add(pid);
      pid = byId.get(pid)?.parentId ?? null;
    }
    return false;
  };
  return layers.filter((l) => set.has(l.id) && !hasSelectedAncestor(l.id)).map((l) => l.id);
}

/**
 * clipped 健全化：クリップは「配列で直下(index+1)の非 group レイヤー」に掛かる（Canvas 準拠）。
 * 直下が group か配列末尾で base を失った clipped は解除する（toggleClipped の制約と一致）。
 * immer draft をそのまま渡してよい（in-place 変更）。
 */
export function sanitizeClips(layers: Layer[]): void {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (!l.clipped) continue;
    const below = layers[i + 1];
    if (
      !below
      || below.type === 'group'
      || (below.parentId ?? null) !== (l.parentId ?? null)
    ) l.clipped = false;
  }
}

/**
 * block（pre-order・子孫閉包を仮定）を新しい id で複製する。
 * block 内を指す parentId は新 id へ張り替え、block 外を指す parentId（＝代表の親）は据置。
 */
export function cloneBlock(block: Layer[]): { clones: Layer[]; idMap: Map<LayerId, LayerId> } {
  const idMap = new Map<LayerId, LayerId>();
  for (const l of block) idMap.set(l.id, crypto.randomUUID());
  const clones = block.map((l) => {
    const c = { ...l, id: idMap.get(l.id)! } as Layer;
    if (l.parentId && idMap.has(l.parentId)) c.parentId = idMap.get(l.parentId)!;
    return c;
  });
  return { clones, idMap };
}

/**
 * ids を target へ移動（または複製）した後の新しいレイヤー配列を返す純関数。
 * - 入力は一切変更しない（全要素を浅コピーしてから操作）。
 * - 変化が無い（no-op）／不正（自己・子孫への drop）の場合は null。
 * - 返り値の `selectIds` は移動後に選択すべき代表 id（複製時は複製側）。
 */
export function computeMove(
  layers: Layer[],
  ids: LayerId[],
  target: DropTarget,
  opts: { duplicate?: boolean } = {},
): { layers: Layer[]; selectIds: LayerId[] } | null {
  const src = layers.map((l) => ({ ...l })) as Layer[];
  const idSet = new Set(src.map((l) => l.id));
  const reps = topLevelReps(src, ids);
  if (reps.length === 0) return null;

  // 移動する全 id（代表 ∪ その子孫）
  const relocSet = new Set<LayerId>();
  for (const r of reps) {
    relocSet.add(r);
    for (const d of collectDescendants(src, r)) relocSet.add(d);
  }

  // ドロップ先の妥当性
  const byId = new Map(src.map((l) => [l.id, l] as const));
  const refId = target.kind === 'into' ? target.groupId : target.refId;
  if (!idSet.has(refId)) return null;
  if (relocSet.has(refId)) return null; // 自分自身/自分の子孫の中へは落とせない（循環防止）
  if (target.kind === 'into' && byId.get(refId)!.type !== 'group') return null;

  const parentOf = (l: Layer): LayerId | null =>
    l.parentId && idSet.has(l.parentId) ? l.parentId : null;
  const newParent: LayerId | null =
    target.kind === 'into' ? target.groupId : parentOf(byId.get(refId)!);

  // 移動ブロック（元配列の pre-order 部分列）と残り
  let moving = src.filter((l) => relocSet.has(l.id));
  let rest = src.filter((l) => !relocSet.has(l.id));
  const repSet = new Set<LayerId>(reps);
  let selectReps = reps;

  if (opts.duplicate) {
    // 複製：moving を新 id で複製し、以後は複製を挿入。原本は据置（rest = 全レイヤー）。
    const { clones, idMap } = cloneBlock(moving);
    moving = clones;
    selectReps = reps.map((r) => idMap.get(r)!);
    repSet.clear();
    for (const r of reps) repSet.add(idMap.get(r)!);
    rest = src;
  }

  // 代表の parentId を張り替え（子孫の parentId は据置＝ブロック内の入れ子を維持）
  for (const l of moving) if (repSet.has(l.id)) l.parentId = newParent;

  // 挿入位置（rest 基準）。before=ref の位置、after/into=ref の直後。
  // sibling 順は最後の normalize が parentId バケット順で確定させるので、
  // group の子孫ブロックを跨ぐ計算は不要（子は親バケットに現れない）。
  const ri = rest.findIndex((l) => l.id === refId);
  let insertAt: number;
  if (ri < 0) insertAt = rest.length;
  else if (target.kind === 'before') insertAt = ri;
  else insertAt = ri + 1;

  const merged = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
  const out = normalizeLayerOrder(merged);
  sanitizeClips(out);

  if (!opts.duplicate) {
    const sig = (ls: Layer[]) =>
      ls.map((l) => `${l.id}:${l.parentId ?? ''}:${l.clipped ? 1 : 0}`).join('|');
    if (sig(out) === sig(layers)) return null; // 実質変化なし＝偽 dirty/偽 undo を防ぐ
  }
  return { layers: out, selectIds: selectReps };
}
