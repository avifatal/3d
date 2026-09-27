// Small, local SVG set: no icon font or network dependency.
const paths = {
 cube: '<path d="m12 3 9 5v8l-9 5-9-5V8Z M3 8l9 5 9-5 M12 13v8"/>',
 intersect: '<rect x="3" y="3" width="12" height="12" rx="2"/><rect x="9" y="9" width="12" height="12" rx="2"/>',
 stack: '<path d="m12 3 9 5-9 5-9-5Z M3 12l9 5 9-5 M3 16l9 5 9-5"/>',
 queue: '<rect x="2" y="9" width="5" height="7" rx="1"/><rect x="10" y="7" width="5" height="9" rx="1"/><path d="M18 5h4v11h-4"/>',
 carve: '<path d="M3 3h18v8h-8v10H3Z M13 11l-4-4 M21 3l-8 8"/>',
 plus: '<path d="M12 5v14 M5 12h14"/>',
 refresh: '<path d="M20 8a9 9 0 1 0 1 8 M20 3v6h-6"/>',
 fit: '<path d="M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
 lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4 M12 15v2"/>',
 unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 7.5-2 M12 15v2"/>',
 undo: '<path d="m9 4-6 6 6 6 M3 10h11a6 6 0 0 1 0 12"/>',
 select: '<path d="m5 3 14 10-7 1-3 7Z"/>',
 sliders: '<path d="M4 7h7m4 0h5 M4 17h3m4 0h9"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
 eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
 eyeOff: '<path d="m3 3 18 18 M10 5c7-1 12 7 12 7l-3 4 M6 6c-3 2-4 6-4 6s4 7 10 7l4-1 M10 10l4 4"/>',
 trash: '<path d="M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7"/>',
 clear: '<path d="m14 3 7 7-10 11H6l-4-4Z M8 11l7 7 M11 21h11"/>',
 grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18 M15 3v18 M3 9h18 M3 15h18"/>',
 solid: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
 cuts: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m4 16 12-12 M10 20 10 10 20 10"/>',
 xray: '<rect x="3" y="3" width="18" height="18" rx="2"/><path stroke-dasharray="2 3" d="M3 3l18 18 M3 21 21 3"/>',
 paper: '<path d="M6 3h9l4 4v14H6Z M14 3v5h5"/>',
 blueprint: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10 M7 12h6 M7 16h10"/>',
 help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3v2 M12 17h.01"/>',
 chevron: '<path d="m6 14 6-6 6 6"/>',
 easier: '<path d="M5 19v-5 M12 19V9 M19 19V4" opacity=".25"/><path d="M5 19v-5"/>',
 harder: '<path d="M19 19V4" opacity=".25"/><path d="M5 19v-5 M12 19V9"/>',
 hardest: '<path d="M5 19v-5 M12 19V9 M19 19V4"/>',
};

export function labelButton( button, label, icon, caption ) {
 button.setAttribute( 'aria-label', label );
 button.title = label;
 button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[ icon ] || paths.cube}</svg><span class="button-label"></span>`;
 button.querySelector( 'span' ).textContent = caption || label;
}

export function initToolbar( viewer ) {
 const panel = document.getElementById( 'panel' );
 const icons = { add: 'plus', regenerate: 'refresh', restack: 'refresh', requeue: 'refresh', recarve: 'refresh', hideSelected: 'eyeOff', deleteSelected: 'trash' };
 for ( const button of panel.querySelectorAll( 'button' ) ) {
  const d = button.dataset;
  const icon = d.icon || icons[ button.id ] || ({ intersecting: 'intersect', stacking: 'stack', queue: 'queue', carving: 'carve' })[ d.exercise ] || d.level || ({ queue:'queue', matrix:'grid' })[ d.arrangement ] || d.guides || ({ hiddenLine: 'solid', xray:'xray' })[ d.mode ] || d.theme;
  const caption = button.textContent.trim();
  if ( d.exercise || d.theme || [ 'regenerate', 'restack', 'requeue', 'recarve' ].includes( button.id ) ) button.classList.add( 'with-label' );
  labelButton( button, button.title || caption, icon, caption );
 }
 const mobile = matchMedia( '(max-width: 700px)' );
 const toggle = document.getElementById( 'togglePanel' );
 const content = document.getElementById( 'toolContent' );
 let expanded = ! mobile.matches;
 function setExpanded( value ) {
  expanded = value;
  panel.classList.toggle( 'is-expanded', value );
  content.hidden = ! value;
  toggle.setAttribute( 'aria-expanded', String( value ) );
  labelButton( toggle, value ? 'Collapse tools' : 'Expand tools', 'chevron' );
 }
 toggle.addEventListener( 'click', () => setExpanded( ! expanded ) );
 mobile.addEventListener( 'change', () => setExpanded( ! mobile.matches ) );
 setExpanded( expanded );
 for ( const tab of panel.querySelectorAll( '[data-tab]' ) ) {
  tab.addEventListener( 'click', () => {
   for ( const other of panel.querySelectorAll( '[data-tab]' ) ) other.setAttribute( 'aria-pressed', String( other === tab ) );
   for ( const page of panel.querySelectorAll( '.tool-page' ) ) page.hidden = page.id !== `${tab.dataset.tab}Tools`;
   setExpanded( true );
   content.scrollTop = 0;
  } );
 }
 const help = document.getElementById( 'toggleHelp' );
 help.addEventListener( 'click', () => {
  const visible = panel.classList.toggle( 'show-help' );
  help.setAttribute( 'aria-pressed', String( visible ) );
  labelButton( help, visible ? 'Hide control hints' : 'Show control hints', 'help' );
  if ( visible ) setExpanded( true );
 } );
 // Expose selected state for screen readers as the existing controls update.
 const sync = () => {
  for ( const button of panel.querySelectorAll( '.segmented button' ) ) button.setAttribute( 'aria-pressed', String( button.classList.contains( 'active' ) ) );
 };
 new MutationObserver( sync ).observe( panel, { subtree: true, attributes: true, attributeFilter: [ 'class' ] } );
 sync();
 // Keep the canvas wholly above the phone sheet, including safe-area padding.
 new ResizeObserver( () => {
  document.documentElement.style.setProperty( '--panel-height', `${panel.getBoundingClientRect().height}px` );
 } ).observe( panel );
 new ResizeObserver( () => viewer.onResize() ).observe( viewer.container );
}
