// The control panel, remembered between visits.
//
// `index.html` stays the single source of truth for what a *fresh* visit
// starts with. Nothing in here carries a default of its own: `restorePanel()`
// rehydrates the controls before `main.js` reads them at startup, so the
// existing "read the button already carrying `.active`" block goes on working
// unchanged, and a stored choice that no longer exists — a level that was
// renamed, a shape that was dropped — falls back to the markup rather than to
// a constant hidden in a module.
//
// Only the panel is kept. The scene is generated, not stored: coming back
// gives you the settings you left, on a fresh arrangement to draw.

const KEY = 'perspective-forms:panel:1';

// Segmented groups: the id of the group, and the data attribute its buttons
// carry the choice in.
const SEGMENTED = {
	exercise: 'exercise',
	level: 'level',
	queueLevel: 'level',
	arrangement: 'arrangement',
	carveGuides: 'guides',
	carveLevel: 'level',
	ribbonLevel: 'level',
	mode: 'mode',
	theme: 'theme',
};

const SELECTS = [ 'shape', 'queueShape' ];
const RANGES = [ 'shading', 'shadow', 'azimuth', 'elevation', 'curveWeight' ];
const CHECKS = [ 'showIntersections', 'showConstruction', 'showPerspective', 'showGrid', 'showHorizon' ];

const $ = id => document.getElementById( id );

/**
 * Storage is not always there to be read: a private window, blocked site data
 * or a half-written entry all turn up here, and none of them are worth a
 * broken page. Every failure means "no preferences", which is the same thing
 * as a first visit.
 */
function stored() {

	try {

		const state = JSON.parse( localStorage.getItem( KEY ) );
		return state && typeof state === 'object' ? state : {};

	} catch ( error ) {

		return {};

	}

}

/** Write the panel as it now stands. Called after anything in it changes. */
export function rememberPanel() {

	const state = { segmented: {}, selects: {}, ranges: {}, checks: {} };

	for ( const [ id, attribute ] of Object.entries( SEGMENTED ) ) {

		const active = $( id )?.querySelector( 'button.active' );
		if ( active ) state.segmented[ id ] = active.dataset[ attribute ];

	}

	for ( const id of SELECTS ) if ( $( id ) ) state.selects[ id ] = $( id ).value;
	for ( const id of RANGES ) if ( $( id ) ) state.ranges[ id ] = Number( $( id ).value );
	for ( const id of CHECKS ) if ( $( id ) ) state.checks[ id ] = $( id ).checked;

	try {

		localStorage.setItem( KEY, JSON.stringify( state ) );

	} catch ( error ) {

		// Nothing to do and nothing to say: the panel still works, it just
		// will not be remembered.

	}

}

/**
 * Put the stored choices back into the markup. Run this before anything reads
 * the controls, and every value that cannot be honoured is simply left as the
 * markup has it.
 */
export function restorePanel() {

	const state = stored();
	const { segmented = {}, selects = {}, ranges = {}, checks = {} } = state;

	for ( const [ id, attribute ] of Object.entries( SEGMENTED ) ) {

		const group = $( id );
		const value = segmented[ id ];
		if ( ! group || typeof value !== 'string' ) continue;

		const button = [ ...group.children ].find( child => child.dataset[ attribute ] === value );
		if ( ! button ) continue;

		for ( const child of group.children ) child.classList.toggle( 'active', child === button );

	}

	for ( const id of SELECTS ) {

		const select = $( id );
		const value = selects[ id ];
		if ( ! select || typeof value !== 'string' ) continue;

		// Assigning a value no option carries blanks the select entirely.
		if ( [ ...select.options ].some( option => option.value === value ) ) select.value = value;

	}

	for ( const id of RANGES ) {

		const input = $( id );
		const value = ranges[ id ];
		if ( ! input || ! Number.isFinite( value ) ) continue;
		if ( value < Number( input.min ) || value > Number( input.max ) ) continue;

		input.value = String( value );

	}

	for ( const id of CHECKS ) {

		const input = $( id );
		if ( input && typeof checks[ id ] === 'boolean' ) input.checked = checks[ id ];

	}

}
