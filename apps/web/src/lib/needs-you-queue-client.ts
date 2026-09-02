import type { NeedsYouQueue } from "@/server/needs-you/queries";

function countsFromItems(items: NeedsYouQueue["items"]): NeedsYouQueue["counts"] {
  const byKind: Record<string, number> = {};
  for (const item of items) {
    byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
  }
  return { total: items.length, byKind };
}

/** Optimistically drop a resolved queue item without waiting for a server refetch. */
export function removeItemFromNeedsYouQueue(queue: NeedsYouQueue, itemId: string): NeedsYouQueue {
  const items = queue.items.filter((item) => item.id !== itemId);
  const groups = queue.groups
    .map((group) => {
      const nextItems = group.items.filter((item) => item.id !== itemId);
      return { ...group, items: nextItems, fieldCount: nextItems.length };
    })
    .filter((group) => group.items.length > 0);

  return { ...queue, items, groups, counts: countsFromItems(items) };
}

/** Optimistically drop every item for an application (e.g. after delete). */
export function removeApplicationFromNeedsYouQueue(
  queue: NeedsYouQueue,
  applicationId: string,
): NeedsYouQueue {
  const items = queue.items.filter((item) => item.applicationId !== applicationId);
  const groups = queue.groups.filter((group) => group.applicationId !== applicationId);
  const openApplicationIds = queue.openApplicationIds.filter((id) => id !== applicationId);

  return {
    ...queue,
    items,
    groups,
    openApplicationIds,
    counts: countsFromItems(items),
  };
}
