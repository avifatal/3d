import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { generateRibbon, LEVELS } from '../src/ribbon.js';
import { buildEdgeData, extractContour, maxContourSegments } from '../src/silhouette.js';

let seed = 4321;
const rng = () => ( ( seed = ( Math.imul( seed, 1664525 ) + 1013904223 ) >>> 0 ) / 4294967296 );
for ( const level of LEVELS ) {
 for ( let sample = 0; sample < 100; sample ++ ) {
  const { geometry, construction, width, bends, segments, acrossSegments } = generateRibbon( level.id, rng );
  const p = geometry.getAttribute( 'position' );
  assert.ok( Array.from( p.array ).every( Number.isFinite ) );
  const a = new Vector3(), b = new Vector3(), across = new Vector3();
  for ( let i = 0; i < p.count; i += acrossSegments + 1 ) {
   a.fromBufferAttribute( p, i ); b.fromBufferAttribute( p, i + acrossSegments ).sub( a );
   assert.ok( Math.abs( b.length() - width ) < 1e-6, 'constant strip width' );
   if ( i === 0 ) across.copy( b );
   assert.ok( across.distanceTo( b ) < 1e-6, 'edges stay parallel' );
  }
  // Recover bend heights from the actual mesh after arbitrary rotation.
  // The chord between the strip's end centres is the profile baseline.
  const center = i => new Vector3().fromBufferAttribute( p, i * 2 )
   .add( new Vector3().fromBufferAttribute( p, i * 2 + 1 ) ).multiplyScalar( 0.5 );
  const origin = center( 0 );
  const axis = center( segments ).sub( origin ).normalize();
  const heights = [];
  for ( let i = 0; i <= segments; i ++ ) {
   const v = center( i ).sub( origin );
   heights.push( v.addScaledVector( axis, -v.dot( axis ) ).length() );
  }
  const peaks = heights.filter( ( h, i ) => i > 0 && i < segments && h > heights[ i - 1 ] && h >= heights[ i + 1 ] );
  assert.equal( peaks.length, bends, 'each bend remains distinct' );
  if ( bends > 1 ) assert.ok( Math.max( ...peaks ) / Math.min( ...peaks ) > 1.7, 'bend sizes visibly differ within a ribbon' );
  const data = buildEdgeData( geometry, 18, true );
  assert.equal( data.hardSegments.length / 6, 2 * ( segments + acrossSegments ), 'only the complete perimeter is drawn as hard edges' );
  assert.equal( construction.length, bends * 4 - 1 );
  const out = new Float32Array( maxContourSegments( data ) * 6 );
  let contours = 0;
  for ( const eye of [ [ 15, 0, 0 ], [ 0, 15, 0 ], [ 0, 0, 15 ], [ -15, 0, 0 ], [ 0, -15, 0 ], [ 0, 0, -15 ], [ 10, 0, 10 ], [ -10, 0, -10 ], [ 7, 5, 9 ], [ -7, -5, -9 ] ] ) {
   const count = extractContour( data, ...eye, out );
   contours += count;
   assert.ok( Array.from( out.slice( 0, count * 6 ) ).every( Number.isFinite ) );
  }
  assert.ok( contours > 0, 'bends produce contours when viewed across the surface' );
  geometry.dispose();
 }
 console.log( `${level.id}: 100 ribbons passed boundary, width, guide and contour checks` );
}
assert.throws( () => generateRibbon( 'unknown' ), /Unknown ribbon level/ );
