import type { PhosFeatureModuleId } from '@/core/module-registry';

export type PatientWorkspacePanelStatus = 'ready' | 'attention' | 'blocked';
export type PatientWorkspacePanelPriority = 'urgent' | 'high' | 'normal' | 'low';

export type PatientWorkspacePanelAction = Readonly<{
  label: string;
  href: string;
  priority: Exclude<PatientWorkspacePanelPriority, 'low'>;
}>;

export type PatientWorkspacePanel = Readonly<{
  module: PhosFeatureModuleId;
  panel_id: string;
  title: string;
  status: PatientWorkspacePanelStatus;
  summary: string;
  priority: PatientWorkspacePanelPriority;
  action_href: string | null;
  next_actions: readonly PatientWorkspacePanelAction[];
  badges?: readonly string[];
  metrics?: readonly {
    label: string;
    value: string | number;
    tone?: 'default' | 'warning' | 'danger';
  }[];
}>;

export type PatientWorkspacePanelProvider<TInput, TPanel> = Readonly<{
  module: PhosFeatureModuleId;
  panelId: string;
  label: string;
  build(input: TInput): Promise<TPanel | null>;
}>;

export type PatientWorkspacePanelRegistry<
  TInput,
  TPanel,
  TPanelId extends string = string,
> = Readonly<{
  get(panelId: string): PatientWorkspacePanelProvider<TInput, TPanel> | null;
  panelIds(): readonly TPanelId[];
  collectAll(input: TInput): Promise<TPanel[]>;
  buildFirst(input: TInput): Promise<TPanel | null>;
}>;

export function createPatientWorkspacePanelRegistry<
  TInput,
  TPanel,
  const TProvider extends readonly PatientWorkspacePanelProvider<TInput, TPanel>[],
>(
  providers: TProvider,
): PatientWorkspacePanelRegistry<TInput, TPanel, TProvider[number]['panelId']> {
  const byPanelId = new Map<string, TProvider[number]>();

  for (const provider of providers) {
    if (byPanelId.has(provider.panelId)) {
      throw new Error(`Duplicate patient workspace panel provider: ${provider.panelId}`);
    }
    byPanelId.set(provider.panelId, provider);
  }

  const panelIds = Object.freeze(Array.from(byPanelId.keys())) as TProvider[number]['panelId'][];

  return Object.freeze({
    get(panelId: string) {
      return byPanelId.get(panelId) ?? null;
    },
    panelIds() {
      return panelIds;
    },
    async collectAll(input: TInput) {
      const panels: TPanel[] = [];
      for (const provider of providers) {
        const panel = await provider.build(input);
        if (panel) panels.push(panel);
      }
      return panels;
    },
    async buildFirst(input: TInput) {
      for (const provider of providers) {
        const panel = await provider.build(input);
        if (panel) return panel;
      }
      return null;
    },
  });
}
