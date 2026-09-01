/** Accept TanStack createServerFn call shape `{ data }` or a direct payload. */
export function unwrapServerFnArgs<T>(input: T | { data: T }): T {
  if (input !== null && typeof input === "object" && "data" in input) {
    return (input as { data: T }).data;
  }
  return input as T;
}
