import { FormScene } from './app.js';
import { ARRANGEMENTS, LEVELS as QUEUE_LEVELS, SHAPE_IDS as QUEUE_SHAPE_IDS } from './queueing.js';
import { SHAPES } from './shapes.js';
import { LEVELS } from './stacking.js';
import { GUIDES } from './subtraction.js';
import { Viewer } from './viewer.js';

const INITIAL_FORMS = 3;

const $ = id => document.getElementById( id );

const viewer = new Viewer( $( 'stage' ) );
const scene = new FormScene( viewer );

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
};

let exercise = 'intersecting';
let level = LEVELS[ 0 ].id;
let queueLevel = QUEUE_LEVELS[ 0 ].id;
let arrangement = ARRANGEMENTS[ 0 ].id;
let lastStack = { boxes: 0, stacks: 0, leaners: 0 };
let lastQueue = { forms: 0, rows: 0, columns: 0, shapeId: QUEUE_SHAPE_IDS[ 0 ] };
let carveGuides = GUIDES[ 0 ].id;
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

	lastCarve = scene.carve( carveGuides );

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

$( 'recarve' ).addEventListener( 'click', () => withBusyState( () => {

	carve();
	report();

} ) );

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
bindCheck( 'showGrid', value => viewer.setGridVisible( value ) );
bindCheck( 'showHorizon', value => viewer.setHorizonVisible( value ) );

// --- keyboard --------------------------------------------------------------

const ORDER = Object.keys( EXERCISES );

/** Levels are per exercise, so the number keys go wherever the user is. */
function setLevelHere( index ) {

	if ( exercise === 'stacking' ) setLevel( LEVELS[ index ].id );
	else if ( exercise === 'queue' ) setQueueLevel( QUEUE_LEVELS[ index ].id );

}

const SHORTCUTS = {
	a: () => exercise === 'intersecting' && addShape( shapeSelect.value ),
	e: () => setExercise( ORDER[ ( ORDER.indexOf( exercise ) + 1 ) % ORDER.length ] ),
	q: () => exercise === 'queue' && setArrangement( arrangement === 'queue' ? 'matrix' : 'queue' ),
	n: () => withBusyState( () => { EXERCISES[ exercise ].start(); report(); } ),
	z: () => { scene.removeLast(); report(); },
	f: () => scene.frame(),
	x: () => $( 'mode' ).querySelector( 'button:not(.active)' ).click(),
	1: () => setLevelHere( 0 ),
	2: () => setLevelHere( 1 ),
	3: () => setLevelHere( 2 ),
};

window.addEventListener( 'keydown', event => {

	if ( event.metaKey || event.ctrlKey || event.altKey ) return;
	if ( event.target.matches( 'input, select, textarea' ) ) return;

	const action = SHORTCUTS[ event.key.toLowerCase() ];
	if ( ! action ) return;

	event.preventDefault();
	action();

} );

// The markup is the single source of truth for what starts active, so the
// modules' own defaults can never drift away from the controls that are lit.
selectMode( $( 'mode' ).querySelector( 'button.active' ) );
level = $( 'level' ).querySelector( 'button.active' ).dataset.level;
queueLevel = $( 'queueLevel' ).querySelector( 'button.active' ).dataset.level;
arrangement = $( 'arrangement' ).querySelector( 'button.active' ).dataset.arrangement;
carveGuides = $( 'carveGuides' ).querySelector( 'button.active' ).dataset.guides;
levelNote.textContent = LEVELS.find( entry => entry.id === level ).note;
describeQueue();

scene.regenerate( INITIAL_FORMS );
report();

// Handle for tools/shot.mjs, which drives the page to verify rendering.
window.__app = { viewer, scene };
