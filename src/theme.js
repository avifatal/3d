// Two palettes, both tuned so that hidden lines read as "behind" without
// turning into noise. Hidden colours are mixed toward the background rather
// than made translucent: an opaque line stays in the renderer's opaque pass,
// where render order alone decides what covers what.

import { Color } from 'three';

const mix = ( a, b, t ) => new Color( a ).lerp( new Color( b ), t );

function build( { background, ink, accent, grid, shadow, shadeColor, hidden = 0.66, accentHidden = 0.42, shade = 0.55 } ) {

	return {
		background: new Color( background ),
		ink: new Color( ink ),
		inkHidden: mix( ink, background, hidden ),
		accent: new Color( accent ),
		accentHidden: mix( accent, background, accentHidden ),
		construction: mix( ink, background, 0.62 ),
		grid: new Color( grid ),
		// The dark end of the shading ramp; the lit end is the background, so
		// shaded faces only ever sit below the paper tone. On a dark ground,
		// mixing toward the ink would make shaded faces *lighter* and invert
		// the read, so those themes name their own shade instead.
		shade: shadeColor ? new Color( shadeColor ) : mix( background, ink, shade ),
		shadow: new Color( shadow ),
	};

}

export const THEMES = {
	paper: build( {
		background: '#f2efe8',
		ink: '#1f1d1a',
		accent: '#c23b17',
		grid: '#d8d3c6',
		shadow: '#6c6152',
	} ),
	blueprint: build( {
		background: '#0e2138',
		ink: '#d3e4f6',
		accent: '#ffc73f',
		grid: '#1c3552',
		shadow: '#03101e',
		shadeColor: '#04101d',
		hidden: 0.6,
		accentHidden: 0.45,
	} ),
};
