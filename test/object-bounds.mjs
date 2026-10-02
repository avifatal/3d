import assert from 'node:assert/strict';
import { Box3, BoxGeometry, Euler, Matrix4, Vector3 } from 'three';
import { objectBounds } from '../src/object-bounds.js';
import { generateRibbon, LEVELS } from '../src/ribbon.js';

function checkTight( geometry, bounds ) {
 const inverse = bounds.matrix.clone().invert();
 const p = geometry.attributes.position;
 const actual = new Box3();
 const v = new Vector3();
 for ( let i = 0; i < p.count; i ++ ) actual.expandByPoint( v.fromBufferAttribute( p, i ).applyMatrix4( inverse ) );
 assert.ok( actual.min.distanceTo( bounds.box.min ) < 2e-5 );
 assert.ok( actual.max.distanceTo( bounds.box.max ) < 2e-5 );
}
const rotation = new Matrix4().makeRotationFromEuler( new Euler( 0.7, 0.9, 0.4 ) ).setPosition( 4, -2, 3 );
const box = new BoxGeometry( 1, 3, 5 ).applyMatrix4( rotation );
const bounds = objectBounds( box, rotation );
assert.ok( bounds.box.getSize( new Vector3() ).distanceTo( new Vector3( 1, 3, 5 ) ) < 1e-5, 'rotated box cage matches the solid exactly' );
checkTight( box, bounds );
box.dispose();
let seed = 9;
const rng = () => ((seed = (Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
for ( const level of LEVELS ) {
 for ( let i = 0; i < 20; i ++ ) {
  const ribbon = generateRibbon( level.id, rng );
  const bounds = objectBounds( ribbon.geometry, ribbon.frame );
  assert.ok( Math.abs( bounds.box.getSize( new Vector3() ).z - ribbon.width ) < 1e-5, 'ribbon cage follows the strip width' );
  checkTight( ribbon.geometry, bounds );
  const delta = new Matrix4().makeRotationFromEuler( new Euler( 0.3, -1.1, 0.9 ) ).setPosition( 2, 4, -3 );
  ribbon.geometry.applyMatrix4( delta );
  bounds.matrix.premultiply( delta );
  checkTight( ribbon.geometry, bounds );
  ribbon.geometry.dispose();
 }
}
console.log('Object-aligned bounds: exact rotated box and 60 ribbons remain tight through rigid edits.');
