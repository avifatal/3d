// Surface shading for the forms.
//
// The line-only view has no tonal separation, which makes an intersection
// curve compete with every other line on screen. Giving the surfaces a tone
// puts the curve on a ground it can read against, and a cast shadow re-states
// the depth ordering independently of the lines.
//
// This is a hand-written material rather than one of three's lit materials so
// that "no shading" is exactly the old flat fill and the slider moves smoothly
// away from it: the lit end of the ramp is pinned to the paper colour, so
// turning shading up only ever darkens, never blows out past the background.
// Three's shadow chunks are pulled in so the same material still samples the
// real shadow map.

import { Color, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from 'three';

const vertexShader = /* glsl */`
varying vec3 vWorldNormal;

#include <common>
#include <shadowmap_pars_vertex>

void main() {

	#include <beginnormal_vertex>
	#include <defaultnormal_vertex>

	vWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );

	#include <begin_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>

}
`;

const fragmentShader = /* glsl */`
uniform vec3 uLit;
uniform vec3 uShade;
uniform float uShading;
uniform float uShadow;
uniform vec3 uLightDirection;

varying vec3 vWorldNormal;

#include <common>
#include <packing>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

void main() {

	vec3 normal = normalize( vWorldNormal );
	if ( ! gl_FrontFacing ) normal = - normal;

	// Partly wrapped lambert. A full wrap (incidence * 0.5 + 0.5) is too soft:
	// the hemisphere you can actually see only spans a third of the ramp, so
	// the form barely turns. Wrapping just past the terminator keeps the dark
	// side off flat black while using most of the range.
	float incidence = dot( normal, uLightDirection );
	float lambert = clamp( ( incidence + 0.4 ) / 1.4, 0.0, 1.0 );
	float tone = mix( 1.0, lambert, uShading );

	// Only faces actually turned toward the light are shadow-tested. A face
	// already pointing away is darkened by the lambert term, and testing it
	// as well is what produces the streaky self-shadow acne along the
	// terminator, where the depth comparison is at its most grazing.
	float facing = smoothstep( 0.0, 0.3, incidence );
	tone *= mix( 1.0, getShadowMask(), uShadow * facing );

	gl_FragColor = vec4( mix( uShade, uLit, clamp( tone, 0.0, 1.0 ) ), 1.0 );

	#include <colorspace_fragment>

}
`;

export function createSurfaceMaterial() {

	const material = new ShaderMaterial( {
		lights: true,
		// Nudged away from the eye so the lines lying exactly on these faces
		// still win the depth test. An intersection curve lies on *both*
		// solids at once, so it is the worst case and needs more than a
		// token offset or it stipples.
		polygonOffset: true,
		polygonOffsetFactor: 2,
		polygonOffsetUnits: 3,
		uniforms: UniformsUtils.merge( [
			UniformsLib.lights,
			{
				uLit: { value: new Color( 0xffffff ) },
				uShade: { value: new Color( 0x000000 ) },
				uShading: { value: 0 },
				uShadow: { value: 0 },
				uLightDirection: { value: new Vector3( 0.5, 1, 0.35 ).normalize() },
			},
		] ),
		vertexShader,
		fragmentShader,
	} );

	material.colorWrite = false;
	return material;

}

/** Azimuth/elevation in degrees to a unit direction pointing at the light. */
export function lightDirection( azimuth, elevation, target = new Vector3() ) {

	const a = azimuth * Math.PI / 180;
	const e = elevation * Math.PI / 180;
	return target.set(
		Math.cos( e ) * Math.sin( a ),
		Math.sin( e ),
		Math.cos( e ) * Math.cos( a ),
	).normalize();

}
