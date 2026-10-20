import postcss from 'postcss';

// Streamlabs substitutes its template variables; OBS custom CSS does not.
// Preserve the installed font size and leave event visibility/timing entirely
// to the provider when adapting its generated stylesheet for an OBS override.
export function prepareObsChatCss(providerCss, installedCss) {
  let fontSize;
  postcss.parse(installedCss).walkRules((rule) => {
    if (rule.selector === 'body')
      rule.walkDecls('font-size', (declaration) => {
        fontSize = declaration.value;
      });
  });
  if (!fontSize || !/^\d+(?:\.\d+)?px$/.test(fontSize))
    throw new Error('Verify the existing Streamlabs body font size in pixels before deployment.');
  const stylesheet = postcss.parse(
    providerCss
      .replaceAll('{font_size}', 'var(--provider-font-size)')
      .replaceAll('{message_hide_delay}', 'var(--provider-hide-delay)'),
  );
  stylesheet.walkDecls((declaration) => {
    if (declaration.prop === 'animation' || declaration.prop.startsWith('animation-'))
      declaration.remove();
    else if (declaration.value.includes('var(--provider-font-size)'))
      declaration.value = declaration.value.replaceAll('var(--provider-font-size)', fontSize);
  });
  stylesheet.walkAtRules(/^(?:-webkit-)?keyframes$/, (rule) => rule.remove());
  stylesheet.walkComments((comment) => {
    if (comment.text.includes('Keep var(--provider-font-size)')) comment.remove();
  });
  const result = stylesheet.toString();
  if (/\{font_size\}|\{message_hide_delay\}|var\(--provider-/.test(result))
    throw new Error('Unresolved provider template variable; refusing OBS deployment.');
  return result;
}
