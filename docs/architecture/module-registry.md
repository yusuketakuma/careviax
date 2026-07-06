# PH-OS Module Registry

`src/core/module-registry` defines module metadata types and small integrity
helpers. It deliberately imports no feature module.

`src/modules/pharmacy` defines the only active feature module today.
`src/modules/active-modules.ts` is the composition root:

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

## Reserved Future Modules

The reserved module ids are:

- `home_medical`
- `home_nursing`
- `network_ops`

They are not implemented until their product scope is approved. Adding them
should require no `core -> modules/*` import and no rewrite of pharmacy code.
