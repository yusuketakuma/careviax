export type CollaborationAccessProvider<
  TContext,
  TDb,
  TEntityType extends string = string,
> = Readonly<{
  entityType: TEntityType;
  canAccess(args: {
    ctx: TContext;
    db: TDb;
    entityId: string;
    orgScoped: boolean;
  }): Promise<boolean>;
}>;

export type CollaborationAccessRegistry<
  TContext,
  TDb,
  TEntityType extends string = string,
> = Readonly<{
  get(entityType: string): CollaborationAccessProvider<TContext, TDb, TEntityType> | null;
  entityTypes(): readonly TEntityType[];
  canAccess(args: {
    ctx: TContext;
    db: TDb;
    entityType: string;
    entityId: string;
    orgScoped: boolean;
  }): Promise<boolean>;
}>;

export function createCollaborationAccessRegistry<
  TContext,
  TDb,
  const TProvider extends readonly CollaborationAccessProvider<TContext, TDb>[],
>(
  providers: TProvider,
): CollaborationAccessRegistry<TContext, TDb, TProvider[number]['entityType']> {
  const byEntityType = new Map<string, TProvider[number]>();

  for (const provider of providers) {
    if (byEntityType.has(provider.entityType)) {
      throw new Error(`Duplicate collaboration access provider: ${provider.entityType}`);
    }
    byEntityType.set(provider.entityType, provider);
  }

  const entityTypes = Object.freeze(Array.from(byEntityType.keys()));

  return Object.freeze({
    get(entityType: string) {
      return byEntityType.get(entityType) ?? null;
    },
    entityTypes() {
      return entityTypes;
    },
    async canAccess(args) {
      const provider = byEntityType.get(args.entityType);
      if (!provider) return false;

      try {
        return (await provider.canAccess(args)) === true;
      } catch {
        return false;
      }
    },
  });
}
