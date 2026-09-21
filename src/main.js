import { FormScene } from './app.js';
import { SHAPES } from './shapes.js';
import { Viewer } from './viewer.js';

const viewer = new Viewer( document.getElementById( 'stage' ) );
const scene = new FormScene( viewer );

const INITIAL_FORMS = 3;

const $ = id => document.getElementById( id );
const shapeSelect = $( 'shape' );
const addButton = $( 'add' );
const status = $( 'status' );

for ( const shape of SHAPES ) {

	const option = document.createElement( 'option' );
	option.value = shape.id;
	option.textContent = shape.label;
	shapeSelect.append( option );

}

function report( message, warn = false ) {

	const { forms, pairs, curves } = scene.stats();
	const summary = `${forms} form${forms === 1 ? '' : 's'} · ${pairs} intersecting pair${pairs === 1 ? '' : 's'} · ${curves} curve${curves === 1 ? '' : 's'}`;
	status.textContent = message ? `${summary} — ${message}` : summary;
	status.classList.toggle( 'warn', warn );

}

/**
 * Placement runs a handful of CSG evaluations, which can take a couple of
 * hundred milliseconds. Yield a frame first so the button's disabled state
 * actually paints instead of appearing after the work is already done.
 */
function withBusyState( work ) {

	addButton.disabled = true;
	status.textContent = 'placing…';
	status.classList.remove( 'warn' );

	requestAnimationFrame( () => requestAnimationFrame( () => {

		try {

			work();

		} finally {

			addButton.disabled = false;

		}

	} ) );

}

function addShape( shapeId ) {

	withBusyState( () => {

		const result = scene.addForm( shapeId );
		if ( result.ok ) {

			report( result.pairs > 1 ? `cuts ${result.pairs} forms` : '' );

		} else {

			report( result.reason, true );

		}

	} );

}

addButton.addEventListener( 'click', () => addShape( shapeSelect.value ) );

$( 'regenerate' ).addEventListener( 'click', () => withBusyState( () => {

	scene.regenerate( INITIAL_FORMS );
	report();

} ) );

$( 'undo' ).addEventListener( 'click', () => {

	scene.removeLast();
	report();

} );

$( 'clear' ).addEventListener( 'click', () => {

	scene.clear();
	report();

} );

$( 'fit' ).addEventListener( 'click', () => scene.frame() );

const modeNote = $( 'modeNote' );
const NOTES = {
	xray: 'Hidden lines stay faint, so you can see the whole construction through the forms.',
	hiddenLine: 'Occluded lines are removed, so what is in front reads unambiguously.',
};

function selectMode( button ) {

	for ( const sibling of button.parentElement.children ) sibling.classList.toggle( 'active', sibling === button );
	scene.setMode( button.dataset.mode );
	modeNote.textContent = NOTES[ button.dataset.mode ];

}

$( 'mode' ).addEventListener( 'click', event => {

	const button = event.target.closest( 'button[data-mode]' );
	if ( button ) selectMode( button );

} );

// The markup is the single source of truth for which style starts active, so
// the viewer's own default can never drift away from the button that is lit.
selectMode( $( 'mode' ).querySelector( 'button.active' ) );

$( 'theme' ).addEventListener( 'click', event => {

	const button = event.target.closest( 'button[data-theme]' );
	if ( ! button ) return;

	for ( const sibling of button.parentElement.children ) sibling.classList.toggle( 'active', sibling === button );
	document.documentElement.dataset.theme = button.dataset.theme;
	viewer.setTheme( button.dataset.theme );

} );

function bindSlider( id, apply, format = value => String( value ) ) {

	const input = $( id );
	const output = input.parentElement.querySelector( 'output' );

	const update = () => {

		const value = Number( input.value );
		output.textContent = format( value );
		apply( value );

	};

	input.addEventListener( 'input', update );
	update();

}

bindSlider( 'shading', value => viewer.setShading( value / 100 ) );
bindSlider( 'shadow', value => viewer.setShadowStrength( value / 100 ) );
bindSlider( 'azimuth', value => viewer.setLightAngle( value, viewer.elevation ), value => `${value}°` );
bindSlider( 'elevation', value => viewer.setLightAngle( viewer.azimuth, value ), value => `${value}°` );
bindSlider( 'curveWeight', value => viewer.setCurveWeight( value ), value => value.toFixed( 1 ) );

$( 'showIntersections' ).addEventListener( 'change', event => scene.setIntersectionsVisible( event.target.checked ) );
$( 'showConstruction' ).addEventListener( 'change', event => scene.setConstructionVisible( event.target.checked ) );
$( 'showGrid' ).addEventListener( 'change', event => viewer.setGridVisible( event.target.checked ) );

const SHORTCUTS = {
	a: () => addShape( shapeSelect.value ),
	n: () => withBusyState( () => { scene.regenerate( INITIAL_FORMS ); report(); } ),
	z: () => { scene.removeLast(); report(); },
	f: () => scene.frame(),
	x: () => $( 'mode' ).querySelector( 'button:not(.active)' ).click(),
};

window.addEventListener( 'keydown', event => {

	if ( event.metaKey || event.ctrlKey || event.altKey ) return;
	if ( event.target.matches( 'input, select, textarea' ) ) return;

	const action = SHORTCUTS[ event.key.toLowerCase() ];
	if ( ! action ) return;

	event.preventDefault();
	action();

} );

scene.regenerate( INITIAL_FORMS );
report();

// Handle for tools/shot.mjs, which drives the page to verify rendering.
window.__app = { viewer, scene };
