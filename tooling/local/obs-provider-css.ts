import postcss from 'postcss';

const DIGIT_DOTDIGIT_PX_RE = /^\d+(?:\.\d+)?px$/;
const FONT_SIZE_MESSAGE_HIDE_RE = /\{font_size\}|\{message_hide_delay\}|var\(--provider-/;
const WEBKIT_KEYFRAMES_RE = /^(?:-webkit-)?keyframes$/;

// Streamlabs substitutes its template variables; OBS custom CSS does not.
// Preserve the installed font size and leave event visibility/timing entirely
// to the provider when adapting its generated stylesheet for an OBS override.
export function prepareObsChatCss(providerCss: string, installedCss: string) {
  let fontSize: string | undefined;
  postcss.parse(installedCss).walkRules((rule) => {
    if (rule.selector === 'body') {
      rule.walkDecls('font-size', (declaration) => {
        fontSize = declaration.value;
      });
    }
  });
  if (!(fontSize && DIGIT_DOTDIGIT_PX_RE.test(fontSize))) {
    throw new Error('Verify the existing Streamlabs body font size in pixels before deployment.');
  }
  const installedFontSize = fontSize;
  const stylesheet = postcss.parse(
    providerCss
      .replaceAll('{font_size}', 'var(--provider-font-size)')
      .replaceAll('{message_hide_delay}', 'var(--provider-hide-delay)'),
  );
  stylesheet.walkDecls((declaration) => {
    if (declaration.prop === 'animation' || declaration.prop.startsWith('animation-')) {
      declaration.remove();
    } else if (declaration.value.includes('var(--provider-font-size)')) {
      declaration.value = declaration.value.replaceAll(
        'var(--provider-font-size)',
        installedFontSize,
      );
    }
  });
  stylesheet.walkAtRules(WEBKIT_KEYFRAMES_RE, (rule) => {
    rule.remove();
  });
  stylesheet.walkComments((comment) => {
    if (comment.text.includes('Keep var(--provider-font-size)')) {
      comment.remove();
    }
  });
  const result = stylesheet.toString();
  if (FONT_SIZE_MESSAGE_HIDE_RE.test(result)) {
    throw new Error('Unresolved provider template variable; refusing OBS deployment.');
  }
  return result;
}
