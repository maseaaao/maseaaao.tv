export function validateActionTargets(actions, sceneNames, inputNames) {
  const scenes = new Set(sceneNames),
    inputs = new Set(inputNames),
    byId = new Map(actions.map((a) => [a.id, a]));
  const issues = [],
    warnings = [];
  let checked = 0;
  for (const action of actions) {
    if (!action.enabled) continue;
    const disabled = new Set(
      (action.subActions || []).filter((s) => s.enabled === false).map((s) => s.id),
    );
    for (const step of action.subActions || []) {
      if (step.enabled === false || disabled.has(step.parentId)) continue;
      if (step.actionId) {
        const target = byId.get(step.actionId);
        if (!target || !target.enabled)
          issues.push(`Action ${action.name} calls a missing or disabled Action.`);
      }
      if (step.connectionId && step.connectionId !== '00000000-0000-0000-0000-000000000000') {
        warnings.push(
          `Action ${action.name}: target belongs to another OBS connection; not checked.`,
        );
        continue;
      }
      if (step.type === 34 && step.sceneName) {
        if (/%[^%]+%/.test(step.sceneName)) {
          warnings.push(`Action ${action.name}: dynamic scene name not checked.`);
          continue;
        }
        checked++;
        if (!scenes.has(step.sceneName))
          issues.push(`Action ${action.name}: OBS scene ${step.sceneName} does not exist.`);
      }
      if (step.inputName && typeof step.inputName === 'string') {
        if (/%[^%]+%/.test(step.inputName)) continue;
        checked++;
        if (!inputs.has(step.inputName))
          issues.push(`Action ${action.name}: OBS input ${step.inputName} does not exist.`);
      }
    }
  }
  return { checked, issues, warnings };
}
