// `SwapTokenOption` lives in the neutral `types/` layer so non-UI
// modules (e.g. `lib/swap-helpers.ts`) can depend on it without
// reaching up into `components/`. This file re-exports it so the
// existing barrel `@/components/features/swap` continues to expose
// the type to UI consumers without any import-path churn.
export type { SwapTokenOption } from '@/types/swap';
