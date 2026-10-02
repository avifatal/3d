import { Box3, Box3Helper, Group, Raycaster, Vector2 } from 'three';
import { PerspectiveGuides } from './perspective-guides.js';
import { ObjectEditor } from './object-editor.js';
import { FormScene } from './app.js';
import { rememberPanel, restorePanel } from './prefs.js';
import { ARRANGEMENTS, LEVELS as QUEUE_LEVELS, SHAPE_IDS as QUEUE_SHAPE_IDS } from './queueing.js';
import { LEVELS as RIBBON_LEVELS } from './ribbon.js';
import { SHAPES } from './shapes.js';
import { LEVELS } from './stacking.js';
import { GUIDES, LEVELS as CARVE_LEVELS } from './subtraction.js';
import { Viewer } from './viewer.js';
import { initToolbar, labelButton } from './toolbar.js';
import { initWakeLock } from './wake-lock.js';

initWakeLock();

const INITIAL_FORMS = 3;

const $ = id => document.getElementById( id );

const viewer = new Viewer( $( 'stage' ) );
const scene = new FormScene( viewer );
const perspectiveGuides = new PerspectiveGuides( viewer, scene );
viewer.onRender( () => perspectiveGuides.update() );
initToolbar( viewer );

const shapeSelect = $( 'shape' );
const addButton = $( 'add' );
const status = $( 'status' );

const queueShapeSelect = $( 'queueShape' );

const shapeLabel = shapeId => SHAPES.find( shape => shape.id === shapeId ).label;

function fillShapes( select, entries ) {

	for ( const [ value, text ] of entries ) {

		const option = document.createElement( 'option' );
		option.value = value;
		option.textContent = text;
		select.append( option );

	}

}

fillShapes( shapeSelect, SHAPES.map( shape => [ shape.id, shape.label ] ) );
fillShapes( queueShapeSelect, [
	...QUEUE_SHAPE_IDS.map( id => [ id, shapeLabel( id ) ] ),
	[ 'random', 'Random' ],
] );

// Last visit's panel, written back into the markup before a single control is
// read. Everything downstream — the sliders, the checkboxes, the block at the
// foot of the file — goes on taking the page as it finds it, so there is
// still exactly one place a default is written, and it is `index.html`.
restorePanel();

// --- exercises -------------------------------------------------------------

const EXERCISES = {
	intersecting: {
		title: 'Intersecting Forms',
		blurb: 'Where solids pass through one another',
		start: () => scene.regenerate( INITIAL_FORMS ),
		summary: () => {

			const { forms, pairs, curves } = scene.stats();
			return `${count( forms, 'form' )} · ${count( pairs, 'intersecting pair' )} · ${count( curves, 'curve' )}`;

		},
	},
	stacking: {
		title: 'Box Stacking',
		blurb: 'Boxes resting in a shared space',
		start: () => stack(),
		summary: () => {

			const { forms, curves } = scene.stats();
			const suffix = curves ? ` · ${count( curves, 'curve' )}` : '';
			return `${count( forms, 'box' )} · ${count( lastStack.stacks, 'stack' )}${
				lastStack.leaners ? ` · ${count( lastStack.leaners, 'leaner' )}` : ''}${suffix}`;

		},
	},
	queue: {
		title: 'Object Queue',
		blurb: 'One form repeated across the eye line',
		// The horizon is the eye line, and this exercise is about distance
		// from it, so it is studied from a levelled camera.
		levelled: true,
		start: () => requeue(),
		summary: () => {

			const { forms, curves } = scene.stats();
			// A queue has no intersections by construction, so a curve here
			// is news: it means two forms found their way into each other.
			const suffix = curves ? ` · ${count( curves, 'curve' )}` : '';
			const shape = shapeLabel( lastQueue.shapeId ).toLowerCase();
			return arrangement === 'matrix'
				? `${count( forms, 'form' )} · ${lastQueue.rows} × ${lastQueue.columns} matrix of ${shape}${suffix}`
				: `${count( forms, 'form' )} · queue of ${shape}${suffix}`;

		},
	},
	carving: {
		title: 'Form Subtraction',
		blurb: 'One solid, carved by others',
		start: () => carve(),
		summary: () => {

			const { forms } = scene.stats();
			if ( ! forms ) return 'no form';
			return `${count( lastCarve.cuts, 'cut' )} · ${Math.round( lastCarve.removed * 100 )}% removed`;

		},
	},
	ribbon: {
		title: 'Ribbon',
		blurb: 'A flowing strip turning through space',
		start: () => ribbon(),
		summary: () => scene.forms.length ? `1 ribbon · ${count( lastRibbon.bends, 'bend' )}` : '0 ribbons',
	},
};

let ribbonLevel = RIBBON_LEVELS[ 0 ].id;
let lastRibbon = { bends: 0 };
let exercise = 'intersecting';
let level = LEVELS[ 0 ].id;
let queueLevel = QUEUE_LEVELS[ 0 ].id;
let arrangement = ARRANGEMENTS[ 0 ].id;
let lastStack = { boxes: 0, stacks: 0, leaners: 0 };
let lastQueue = { forms: 0, rows: 0, columns: 0, shapeId: QUEUE_SHAPE_IDS[ 0 ] };
let carveGuides = GUIDES[ 0 ].id;
let carveLevel = CARVE_LEVELS[ 0 ].id;
let lastCarve = { cuts: 0, removed: 0 };

const PLURALS = { box: 'boxes' };
const count = ( n, noun ) => `${n} ${n === 1 ? noun : PLURALS[ noun ] ?? `${noun}s` }`;

function report( message, warn = false ) {

	const summary = EXERCISES[ exercise ].summary();
	status.textContent = message ? `${summary} — ${message}` : summary;
	status.classList.toggle( 'warn', warn );

}

/**
 * Generating a scene runs a run of CSG evaluations and can take a couple of
 * hundred milliseconds. Yield a frame first so the busy state actually paints
 * instead of appearing after the work is already done.
 */
function withBusyState( work ) {

	addButton.disabled = true;
	status.textContent = 'working…';
	status.classList.remove( 'warn' );

	requestAnimationFrame( () => requestAnimationFrame( () => {

		try {

			work();

		} finally {

			addButton.disabled = false;

		}

	} ) );

}

function stack() {

	lastStack = scene.stack( level );

}

function requeue() {

	lastQueue = scene.queue( arrangement, queueLevel, queueShapeSelect.value );

}

function carve() {

	lastCarve = scene.carve( carveGuides, carveLevel );

}

function setExercise( name ) {

	exercise = name;

	for ( const button of $( 'exercise' ).children ) {

		button.classList.toggle( 'active', button.dataset.exercise === name );

	}

	for ( const panel of document.querySelectorAll( '[data-exercise-panel]' ) ) {

		panel.hidden = panel.dataset.exercisePanel !== name;

	}

	$( 'exerciseTitle' ).textContent = EXERCISES[ name ].title;
	$( 'exerciseBlurb' ).textContent = EXERCISES[ name ].blurb;

	withBusyState( () => {

		EXERCISES[ name ].start();

		// Switching exercise is the one moment it is fair to take the camera
		// off whatever angle the user orbited to, and the levelled view the
		// queue needs has to be handed back when the queue is left.
		scene.frame( { pitch: EXERCISES[ name ].levelled ? 0 : viewer.defaultPitch } );
		report();

	} );

}

$( 'exercise' ).addEventListener( 'click', event => {

	const button = event.target.closest( 'button[data-exercise]' );
	if ( button && button.dataset.exercise !== exercise ) setExercise( button.dataset.exercise );

} );

// --- intersecting forms ----------------------------------------------------

function addShape( shapeId ) {

	withBusyState( () => {

		const result = scene.addForm( shapeId );
		report( result.ok
			? ( result.pairs > 1 ? `cuts ${result.pairs} forms` : '' )
			: result.reason, ! result.ok );

	} );

}

addButton.addEventListener( 'click', () => addShape( shapeSelect.value ) );

$( 'regenerate' ).addEventListener( 'click', () => withBusyState( () => {

	scene.regenerate( INITIAL_FORMS );
	report();

} ) );

// --- box stacking ----------------------------------------------------------

const levelNote = $( 'levelNote' );

function setLevel( id ) {

	level = id;

	for ( const button of $( 'level' ).children ) {

		button.classList.toggle( 'active', button.dataset.level === id );

	}

	levelNote.textContent = LEVELS.find( entry => entry.id === id ).note;

	withBusyState( () => {

		stack();
		report();

	} );

}

$( 'level' ).addEventListener( 'click', event => {

	const button = event.target.closest( 'button[data-level]' );
	if ( button ) setLevel( button.dataset.level );

} );

$( 'restack' ).addEventListener( 'click', () => withBusyState( () => {

	stack();
	report();

} ) );

// --- object queue ----------------------------------------------------------

const queueLevelNote = $( 'queueLevelNote' );

function describeQueue() {

	queueLevelNote.textContent = QUEUE_LEVELS.find( entry => entry.id === queueLevel ).note[ arrangement ];

}

function setArrangement( id ) {

	arrangement = id;

	for ( const button of $( 'arrangement' ).children ) {

		button.classList.toggle( 'active', button.dataset.arrangement === id );

	}

	describeQueue();

	withBusyState( () => {

		requeue();
		report();

	} );

}

function setQueueLevel( id ) {

	queueLevel = id;

	for ( const button of $( 'queueLevel' ).children ) {

		button.classList.toggle( 'active', button.dataset.level === id );

	}

	describeQueue();

	withBusyState( () => {

		requeue();
		report();

	} );

}

$( 'arrangement' ).addEventListener( 'click', event => {

	const button = event.target.closest( 'button[data-arrangement]' );
	if ( button ) setArrangement( button.dataset.arrangement );

} );

$( 'queueLevel' ).addEventListener( 'click', event => {

	const button = event.target.closest( 'button[data-level]' );
	if ( button ) setQueueLevel( button.dataset.level );

} );

queueShapeSelect.addEventListener( 'change', () => withBusyState( () => {

	requeue();
	report();

} ) );

$( 'requeue' ).addEventListener( 'click', () => withBusyState( () => {

	requeue();
	report();

} ) );

// --- form subtraction ------------------------------------------------------

/**
 * Changing what the guides show must not generate a new form: the one on
 * screen is the one being drawn.
 */
function setCarveGuides( id ) {

	carveGuides = id;

	for ( const button of $( 'carveGuides' ).children ) {

		button.classList.toggle( 'active', button.dataset.guides === id );

	}

	scene.setCarveGuides( id );

	// Choosing what the guides show is a request to see them. The only thing
	// that makes them visible is the shared checkbox three sections further
	// down the panel, so with it off both choices redraw lines nobody can
	// see and the control reads as dead. Switch it on and let it follow.
	showConstructionGuides( true );

}

$( 'carveGuides' ).addEventListener( 'click', event => {

	const button = event.target.closest( 'button[data-guides]' );
	if ( button ) setCarveGuides( button.dataset.guides );

} );

function setCarveLevel( id ) {

	carveLevel = id;
	for ( const button of $( 'carveLevel' ).children ) {

		button.classList.toggle( 'active', button.dataset.level === id );

	}
	$( 'carveLevelNote' ).textContent = CARVE_LEVELS.find( entry => entry.id === id ).note;
	withBusyState( () => { carve(); report(); } );

}

$( 'carveLevel' ).addEventListener( 'click', event => {

	const button = event.target.closest( 'button[data-level]' );
	if ( button ) setCarveLevel( button.dataset.level );

} );

$( 'recarve' ).addEventListener( 'click', () => withBusyState( () => {

	carve();
	report();

} ) );

// --- ribbons ---------------------------------------------------------------

function ribbon() {

	lastRibbon = scene.ribbon( ribbonLevel );

}

function setRibbonLevel( id ) {

	ribbonLevel = id;
	for ( const button of $( 'ribbonLevel' ).children ) {

		button.classList.toggle( 'active', button.dataset.level === id );

	}
	$( 'ribbonLevelNote' ).textContent = RIBBON_LEVELS.find( entry => entry.id === id ).note;
	withBusyState( () => { ribbon(); report(); } );

}

$( 'ribbonLevel' ).addEventListener( 'click', event => {

	const button = event.target.closest( 'button[data-level]' );
	if ( button ) setRibbonLevel( button.dataset.level );

} );
$( 'reribbon' ).addEventListener( 'click', () => withBusyState( () => { ribbon(); report(); } ) );

// --- object selection ------------------------------------------------------

const selectionFrames = new Map();

function updateSelectionBox() {

	for ( const [ form, frame ] of selectionFrames ) {

		if ( scene.selection.has( form ) ) continue;
		frame.removeFromParent();
		frame.children[ 0 ].dispose();
		selectionFrames.delete( form );

	}
	for ( const form of scene.selection ) {

		let frame = selectionFrames.get( form );
		if ( !frame ) {

			const box = new Box3Helper( new Box3(), 0xc23b17 );
			Object.assign( box.material, { depthTest: false, transparent: true, opacity: 0.55, depthWrite: false } );
			box.renderOrder = 3;
			frame = new Group();
			frame.matrixAutoUpdate = false;
			frame.add( box );
			viewer.scene.add( frame );
			selectionFrames.set( form, frame );

		}
		frame.name = form === scene.selected ? 'selectionBounds' : 'selectionBoundsSecondary';
		frame.visible = !form.faint;
		frame.children[ 0 ].box.copy( form.objectBounds.box );
		frame.matrix.copy( form.objectBounds.matrix );
		if ( form.previewMatrix ) frame.matrix.premultiply( form.previewMatrix );
		frame.matrixWorldNeedsUpdate = true;

	}

}

const editor = new ObjectEditor( viewer, scene,
	updateSelectionBox, () => report( 'object transformed' ) );
$( 'transformMode' ).addEventListener( 'click', event => {

	const button = event.target.closest( '[data-transform]' );
	if ( button ) editor.setMode( button.dataset.transform );

} );
$( 'undoTransform' ).addEventListener( 'click', () => editor.undo() );

scene.onChange = () => {

	$( 'deleteSelected' ).disabled = ! scene.selected;
	$( 'hideSelected' ).disabled = ! scene.selected;
	const allHidden = scene.selection.size > 0 && [ ...scene.selection ].every( form => form.faint );
	const noun = scene.selection.size > 1 ? 'objects' : 'object';
	labelButton( $( 'hideSelected' ), `${allHidden ? 'Show' : 'Hide'} ${noun} (H)`, allHidden ? 'eye' : 'eyeOff' );
	$( 'hideSelected' ).setAttribute( 'aria-pressed', String( allHidden ) );
	updateSelectionBox();
	editor.sync();

};

function deleteSelected() {

	editor.cancel();
	const forms = [ ...scene.selection ];
	for ( const form of forms ) scene.removeForm( form );
	if ( forms.length ) report( `${count( forms.length, 'object' )} deleted` );

}

function toggleSelected() {

	if ( ! scene.selected ) return;
	editor.cancel();
	const forms = [ ...scene.selection ];
	const faint = !forms.every( form => form.faint );
	for ( const form of forms ) scene.setFaint( form, faint );
	report( `${count( forms.length, 'object' )} ${faint ? 'hidden' : 'restored'}` );

}

$( 'deleteSelected' ).addEventListener( 'click', deleteSelected );
$( 'hideSelected' ).addEventListener( 'click', toggleSelected );

const canvas = viewer.renderer.domElement;
const raycaster = new Raycaster();
let press = null;
const pointers = new Set();
canvas.addEventListener( 'pointerdown', event => {

	pointers.add( event.pointerId );
	press = ! editor.gesture && pointers.size === 1 && event.button === 0
		? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;

} );
canvas.addEventListener( 'pointermove', event => {

	if ( press && Math.hypot( event.clientX - press.x, event.clientY - press.y ) > 5 ) press = null;

} );
canvas.addEventListener( 'pointercancel', event => {

	pointers.delete( event.pointerId );
	press = null;

} );
canvas.addEventListener( 'pointerup', event => {

	pointers.delete( event.pointerId );
	const click = press;
	press = null;
	if ( editor.gesture || ! click || click.id !== event.pointerId ) return;
	const rect = canvas.getBoundingClientRect();
	raycaster.setFromCamera( new Vector2(
		( event.clientX - rect.left ) / rect.width * 2 - 1,
		- ( event.clientY - rect.top ) / rect.height * 2 + 1,
	), viewer.camera );
	// Prefer visible forms so a hidden one never blocks selection behind it.
	const hits = raycaster.intersectObjects( scene.forms.map( form => form.mesh ), false );
	const forms = hits.map( hit => scene.forms.find( form => form.mesh === hit.object ) );
	scene.select( forms.find( form => ! form.faint ) ?? forms[ 0 ], event.ctrlKey || event.metaKey );

} );

// --- scene -----------------------------------------------------------------

$( 'undo' ).addEventListener( 'click', () => {

	scene.removeLast();
	report();

} );

$( 'clear' ).addEventListener( 'click', () => {

	scene.clear();
	report();

} );

$( 'fit' ).addEventListener( 'click', () => scene.frame() );
$( 'newScene' ).addEventListener( 'click', () => withBusyState( () => { EXERCISES[ exercise ].start(); report(); } ) );

$( 'lockCamera' ).addEventListener( 'click', () => {

	const locked = viewer.controls.enableRotate;
	viewer.setCameraLocked( locked );
	$( 'lockCamera' ).setAttribute( 'aria-pressed', String( locked ) );
	labelButton( $( 'lockCamera' ), locked ? 'Unlock camera angle' : 'Lock camera angle; zoom and pan stay available', locked ? 'lock' : 'unlock' );
	$( 'cameraHelp' ).textContent = locked
		? 'Camera angle locked · pinch or scroll to zoom · right-drag or two fingers to pan'
		: 'Drag to orbit · pinch or scroll to zoom · right-drag or two fingers to pan';

} );

// --- shared rendering ------------------------------------------------------

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

function selectTheme( button ) {

	for ( const sibling of button.parentElement.children ) sibling.classList.toggle( 'active', sibling === button );
	document.documentElement.dataset.theme = button.dataset.theme;
	viewer.setTheme( button.dataset.theme );

}

$( 'theme' ).addEventListener( 'click', event => {

	const button = event.target.closest( 'button[data-theme]' );
	if ( button ) selectTheme( button );

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

function bindCheck( id, apply ) {

	const input = $( id );
	input.addEventListener( 'change', () => apply( input.checked ) );
	apply( input.checked );

}

/** The checkbox and the scene, kept in step whoever asked. */
function showConstructionGuides( value ) {

	$( 'showConstruction' ).checked = value;
	scene.setConstructionVisible( value );

}

bindCheck( 'showIntersections', value => scene.setIntersectionsVisible( value ) );
bindCheck( 'showConstruction', value => scene.setConstructionVisible( value ) );
bindCheck( 'showPerspective', value => {

	perspectiveGuides.enabled = value;
	$( 'togglePerspective' ).setAttribute( 'aria-pressed', String( value ) );
	labelButton( $( 'togglePerspective' ), `${value ? 'Hide' : 'Show'} extended perspective lines for selected objects`, 'perspective', 'Perspective lines' );
	perspectiveGuides.update();

} );
$( 'togglePerspective' ).addEventListener( 'click', () => {

	const input = $( 'showPerspective' );
	input.checked = !input.checked;
	input.dispatchEvent( new Event( 'change', { bubbles: true } ) );

} );
bindCheck( 'showGrid', value => viewer.setGridVisible( value ) );
bindCheck( 'showHorizon', value => viewer.setHorizonVisible( value ) );

// --- remembering the panel -------------------------------------------------

/**
 * One listener on the panel rather than a call out of every setter: a control
 * added later is remembered without anyone having to remember to add it, and
 * by the time a click reaches the panel on its way up, the handler that lit
 * the button has already run.
 */
let pendingWrite = 0;

function remember() {

	// A dragged slider fires on every pixel; write once it settles.
	clearTimeout( pendingWrite );
	pendingWrite = setTimeout( rememberPanel, 200 );

}

for ( const type of [ 'click', 'change', 'input' ] ) $( 'panel' ).addEventListener( type, remember );

// Leaving the page must not lose a write that is still waiting on its timer.
window.addEventListener( 'pagehide', () => {

	clearTimeout( pendingWrite );
	rememberPanel();

} );

// --- keyboard --------------------------------------------------------------

const ORDER = Object.keys( EXERCISES );

/** Levels are per exercise, so the number keys go wherever the user is. */
function setLevelHere( index ) {

	if ( exercise === 'ribbon' ) setRibbonLevel( RIBBON_LEVELS[ index ].id );
	else if ( exercise === 'stacking' ) setLevel( LEVELS[ index ].id );
	else if ( exercise === 'queue' ) setQueueLevel( QUEUE_LEVELS[ index ].id );
	else if ( exercise === 'carving' ) setCarveLevel( CARVE_LEVELS[ index ].id );

}

const SHORTCUTS = {
	a: () => exercise === 'intersecting' && addShape( shapeSelect.value ),
	e: () => setExercise( ORDER[ ( ORDER.indexOf( exercise ) + 1 ) % ORDER.length ] ),
	q: () => exercise === 'queue' && setArrangement( arrangement === 'queue' ? 'matrix' : 'queue' ),
	n: () => withBusyState( () => { EXERCISES[ exercise ].start(); report(); } ),
	z: () => { scene.removeLast(); report(); },
	delete: deleteSelected,
	backspace: deleteSelected,
	h: toggleSelected,
	escape: () => { if ( !editor.cancel() ) scene.select( null ); },
	v: () => editor.setMode( 'select' ),
	w: () => editor.setMode( 'translate' ),
	r: () => editor.setMode( 'rotate' ),
	f: () => scene.frame(),
	x: () => $( 'mode' ).querySelector( 'button:not(.active)' ).click(),
	1: () => setLevelHere( 0 ),
	2: () => setLevelHere( 1 ),
	3: () => setLevelHere( 2 ),
};

window.addEventListener( 'keydown', event => {

	if ( event.target.matches( 'input, select, textarea, [contenteditable="true"]' ) ) return;
	if ( ( event.metaKey || event.ctrlKey ) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z' ) {

		event.preventDefault();
		editor.undo();
		return;

	}
	if ( event.metaKey || event.ctrlKey || event.altKey ) return;

	if ( editor.start && event.key !== 'Escape' ) return;
	const action = SHORTCUTS[ event.key.toLowerCase() ];
	if ( ! action ) return;

	event.preventDefault();
	action();
	remember();

} );

// The markup is the single source of truth for what starts active, so the
// modules' own defaults can never drift away from the controls that are lit.
selectMode( $( 'mode' ).querySelector( 'button.active' ) );
ribbonLevel = $( 'ribbonLevel' ).querySelector( 'button.active' ).dataset.level;
$( 'ribbonLevelNote' ).textContent = RIBBON_LEVELS.find( entry => entry.id === ribbonLevel ).note;
level = $( 'level' ).querySelector( 'button.active' ).dataset.level;
queueLevel = $( 'queueLevel' ).querySelector( 'button.active' ).dataset.level;
arrangement = $( 'arrangement' ).querySelector( 'button.active' ).dataset.arrangement;
carveLevel = $( 'carveLevel' ).querySelector( 'button.active' ).dataset.level;
$( 'carveLevelNote' ).textContent = CARVE_LEVELS.find( entry => entry.id === carveLevel ).note;
carveGuides = $( 'carveGuides' ).querySelector( 'button.active' ).dataset.guides;
selectTheme( $( 'theme' ).querySelector( 'button.active' ) );
levelNote.textContent = LEVELS.find( entry => entry.id === level ).note;
describeQueue();

// Opening the exercise is the same job as switching to it, restored or not:
// it lays out the panel, generates the first scene and sets the camera the
// exercise wants.
setExercise( $( 'exercise' ).querySelector( 'button.active' ).dataset.exercise );

// Handle for tools/shot.mjs, which drives the page to verify rendering.
window.__app = { viewer, scene, editor, perspectiveGuides };
