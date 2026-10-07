export function getHeadSortOrder(sortOrders: readonly number[]): number {
  return (sortOrders.length === 0 ? 1000 : Math.min(...sortOrders)) - 1000;
}
