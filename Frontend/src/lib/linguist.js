/**
 * A pragmatic subset of GitHub's linguist language colours — enough to cover
 * every language we're likely to see in a member's topLanguages. Extend as
 * needed. Fallback for unknown languages returns a muted neutral so we never
 * blow up the render.
 */
const COLORS = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572A5',
  Java: '#b07219',
  Kotlin: '#A97BFF',
  Swift: '#F05138',
  Go: '#00ADD8',
  Rust: '#dea584',
  C: '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  Ruby: '#701516',
  PHP: '#4F5D95',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Shell: '#89e051',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Dart: '#00B4AB',
  Elixir: '#6e4a7e',
  Erlang: '#B83998',
  Haskell: '#5e5086',
  Lua: '#000080',
  Perl: '#0298c3',
  Scala: '#c22d40',
  ObjectiveC: '#438eff',
  'Objective-C': '#438eff',
  R: '#198CE7',
  Julia: '#a270ba',
  Assembly: '#6E4C13',
  Makefile: '#427819',
  Dockerfile: '#384d54',
  Markdown: '#083fa1',
  TeX: '#3D6117',
  Lean: '#003676',
  COBOL: '#0059aa',
  Fortran: '#4d41b1',
  'Jupyter Notebook': '#DA5B0B',
};

export function languageColor(name) {
  if (!name) return '#8b949e';
  return COLORS[name] ?? '#8b949e';
}
