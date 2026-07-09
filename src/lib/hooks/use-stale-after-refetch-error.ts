type RefetchableQueryState<TData> = {
  data: TData | null | undefined;
  isError?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
  isRefetchError?: boolean;
};

export function useStaleAfterRefetchError<TData>(query: RefetchableQueryState<TData>) {
  const hasData = query.data != null;
  const isInitialLoading = Boolean((query.isLoading || query.isPending) && !hasData);
  const isStaleAfterRefetchError = Boolean(hasData && (query.isRefetchError || query.isError));
  const isInitialError = Boolean(query.isError && !hasData);

  return {
    hasData,
    isInitialLoading,
    isInitialError,
    isStaleAfterRefetchError,
  };
}
