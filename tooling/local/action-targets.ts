const PLACEHOLDER_RE = /%[^%]+%/;

interface ActionStep {
  actionId?: string;
  connectionId?: string;
  enabled?: boolean;
  id?: string;
  inputName?: unknown;
  parentId?: string;
  sceneName?: string;
  type?: number;
}
export interface Action {
  enabled: boolean;
  id: string;
  name: string;
  subActions?: ActionStep[];
}
export function validateActionTargets(
  actions: Action[],
  sceneNames: string[],
  inputNames: string[],
) {
  const scenes = new Set(sceneNames),
    inputs = new Set(inputNames),
    byId = new Map(actions.map((a) => [a.id, a]));
  const issues: string[] = [],
    warnings: string[] = [];
  let checked = 0;
  function validateScene(step: ActionStep, actionName: string): number {
    let sceneChecked = 0;
    if (step.type === 34 && step.sceneName) {
      if (PLACEHOLDER_RE.test(step.sceneName)) {
        warnings.push(`Action ${actionName}: dynamic scene name not checked.`);
        return 0;
      }
      sceneChecked += 1;
      if (!scenes.has(step.sceneName)) {
        issues.push(`Action ${actionName}: OBS scene ${step.sceneName} does not exist.`);
      }
    }

    return sceneChecked;
  }
  function validateStep(step: ActionStep, actionName: string): number {
    if (step.actionId) {
      const target = byId.get(step.actionId);
      if (!target?.enabled) {
        issues.push(`Action ${actionName} calls a missing or disabled Action.`);
      }
    }
    if (step.connectionId && step.connectionId !== '00000000-0000-0000-0000-000000000000') {
      warnings.push(`Action ${actionName}: target belongs to another OBS connection; not checked.`);
      return 0;
    }
    const dynamicScene = step.type === 34 && step.sceneName && PLACEHOLDER_RE.test(step.sceneName);
    let stepChecked = validateScene(step, actionName);
    if (dynamicScene) {
      return stepChecked;
    }
    if (step.inputName && typeof step.inputName === 'string') {
      if (PLACEHOLDER_RE.test(step.inputName)) {
        return stepChecked;
      }
      stepChecked += 1;
      if (!inputs.has(step.inputName)) {
        issues.push(`Action ${actionName}: OBS input ${step.inputName} does not exist.`);
      }
    }
    return stepChecked;
  }
  for (const action of actions) {
    if (!action.enabled) {
      continue;
    }
    const disabled = new Set(
      (action.subActions || []).filter((s) => s.enabled === false).map((s) => s.id),
    );
    for (const step of action.subActions || []) {
      if (step.enabled === false || disabled.has(step.parentId)) {
        continue;
      }
      checked += validateStep(step, action.name);
    }
  }
  return { checked, issues, warnings };
}
