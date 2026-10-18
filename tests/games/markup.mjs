// Controller fixtures retain real controls and containers; browser tests check
// Astro slot placement and layout.
export async function expandGameControls(html, component) {
  const modes = await component('GameModeMenu');
  html = html.replace(/<GameModeMenu\b[^>]*>([\s\S]*?)<\/GameModeMenu>/g, (_, content) => modes.replace('<slot />', content));
  const shell = await component('GameShell');
  html = html.replace(/<GameShell\b[^>]*>([\s\S]*?)<\/GameShell>/, (_, content) => shell.replace('<slot />', content));
  html = html.replace(/<DailyGameLinks\b[^>]*\/>/, await component('DailyGameLinks'));
  html = html.replace(/<GameTutorial\b[^>]*\/>/, await component('GameTutorial'));
  html = html.replace(/<GameReviewControls\b[^>]*\/>/, await component('GameReviewControls'));
  html = html.replace(/<GameHoleControls\b[^>]*\/>/g, await component('GameHoleControls'));
  html = html.replace(/<GameAutofocus\b[^>]*\/>/g, await component('GameAutofocus'));
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
