# PH-OS Module Registry

`src/core/module-registry` defines module metadata types and small integrity
helpers. It deliberately imports no feature module.

`src/modules/pharmacy` defines the only active feature module today.
`src/modules/active-modules.ts` is the module-metadata composition root:

```ts
export const activeModules = [pharmacyModule];
```

The registry records architecture references:

- owned Prisma model names
- route prefixes
- public service entrypoints
- references to existing risk, task, event, DTO, RLS, and audit registries
- tenant scope
- PHI boundary classification

It must not duplicate the business rules owned by those registries.

Provider registries use separate server-side composition roots. For example,
`src/server/collaboration/active-access-registry.ts` assembles core and pharmacy
collaboration access providers without putting executable authorization logic
into `src/core/module-registry`.

## Reserved Future Modules

The reserved module ids are:

- `home_medical`
- `home_nursing`
- `network_ops`

They are not implemented until their product scope is approved. Adding them
should require no `core -> modules/*` import and no rewrite of pharmacy code.
