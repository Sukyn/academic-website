// Controller fixtures retain real controls and containers; browser tests check
// Astro slot placement and layout.
export async function expandGameControls(html, component) {
  const circuit = await component('CircuitGame');
  html = html.replace(/<CircuitGame\b([^>]*)>([\s\S]*?)<\/CircuitGame>/g, (_, props, content) => circuit
    .replace('{kind}', JSON.stringify(props.match(/\bkind="([^"]*)"/)?.[1]))
    .replace('<slot />', content.replace(/<CategoricalCircuitGame\b[^>]*\/>/g, '')));
  html = html.replace(/<template\b[\s\S]*?<\/template>/g, '');
  const modes = await component('GameModeMenu');
  html = html.replace(/<GameModeMenu\b[^>]*>([\s\S]*?)<\/GameModeMenu>/g, (_, content) => modes.replace('<slot />', content));
  const shell = await component('GameShell');
  html = html.replace(/<GameShell\b[^>]*>([\s\S]*?)<\/GameShell>/, (_, content) => shell.replace('<slot />', content));
  html = html.replace(/<DailyGameLinks\b[^>]*\/>/, await component('DailyGameLinks'));
  html = html.replace(/<GameTutorial\b[^>]*\/>/, await component('GameTutorial'));
  html = html.replace(/<GameReviewControls\b[^>]*\/>/, await component('GameReviewControls'));
  html = html.replace(/<GameHoleControls\b[^>]*\/>/g, await component('GameHoleControls'));
  html = html.replace(/<GameAutofocus\b[^>]*\/>/g, await component('GameAutofocus'));
  const result = await component('GameResultDialog');
  html = html.replace(/<GameResultDialog\b([^>]*?)(?:\/>|>([\s\S]*?)<\/GameResultDialog>)/g, (_, props, content = '') => {
    const flag = (name, fallback) => {
      const value = props.match(new RegExp(`\\b${name}(?:=\\{(true|false)\\})?(?=\\s|$)`));
      return value ? value[1] !== 'false' : fallback;
    };
    const completionOnly = flag('completionOnly', false), ranked = !completionOnly;
    const sharing = flag('sharing', true), daily = flag('daily', true);
    const unit = props.match(/\bunit="([^"]*)"/)?.[1] ?? 'Moves';
    const title = props.match(/\btitle="([^"]*)"/)?.[1];
    const closeLabel = props.match(/\bcloseLabel="([^"]*)"/)?.[1];
    const actions = content.match(/<Fragment slot="result-actions">([\s\S]*?)<\/Fragment>/)?.[1] ?? '';
    return result.replace('<GameWinDialog title={title} closeLabel={closeLabel}>',
      `<GameWinDialog${title === undefined ? '' : ` title="${title}"`}${closeLabel === undefined ? '' : ` closeLabel="${closeLabel}"`}>`)
      .replace('<slot name="result-actions" />', actions)
      .replace(/\{ranked && daily && (<(?:p|div)[\s\S]*?<\/(?:p|div)>)\}/g, ranked && daily ? '$1' : '')
      .replace(/\{ranked && (<p[\s\S]*?<\/p>)\}/g, ranked ? '$1' : '')
      .replace(/\{!completionOnly && (<th[\s\S]*?<\/th>)\}/g, completionOnly ? '' : '$1')
      .replace(/\{sharing && (<button[\s\S]*?<\/button>)\}/g, sharing ? '$1' : '')
      .replace(/\{daily && (<(?:button|div)[\s\S]*?<\/(?:button|div)>)\}/g, daily ? '$1' : '')
      .replace('hidden={ranked}', ranked ? 'hidden' : '')
      .replace(/\{completionOnly \? '([^']*)' : '([^']*)'\}/g, (_, completed, scored) => completionOnly ? completed : scored)
      .replace("{completionOnly ? 'Completed' : unit}", completionOnly ? 'Completed' : unit);
  });
  for (const name of ['GameRulesDialog', 'GameWinDialog']) {
    const shell = await component(name);
    html = html.replace(new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)<\\/${name}>`, 'g'), (_, props, content) =>
      shell.replace('<slot />', content)
        .replace('{closeLabel}', JSON.stringify(props.match(/closeLabel="([^"]*)"/)?.[1] ?? 'Close popup'))
        .replace('{title}', props.match(/title="([^"]*)"/)?.[1] ?? 'GG'));
  }
  const round = await component('GameRoundControls');
  return html.replace(/<GameRoundControls\b([^>]*?)(?:\/>|>([\s\S]*?)<\/GameRoundControls>)/, (_, props, content = '') =>
    round.replace('<slot name="before" />', '').replace('<slot />', content)
      .replace(/\{results && (<button[\s\S]*?<\/button>)\}/, /results=\{false\}/.test(props) ? '' : '$1')
      .replace('{resultLabel}', props.match(/resultLabel="([^"]*)"/)?.[1] ?? 'Scores'));
}
