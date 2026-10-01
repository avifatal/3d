// Keep drawing references visible during long pauses between interactions.
export function initWakeLock() {

	if ( ! navigator.wakeLock ) return;

	let lock = null;
	let pending = false;

	async function requestLock() {

		if ( document.visibilityState !== 'visible' || pending || ( lock && ! lock.released ) ) return;

		pending = true;
		try {

			const acquired = await navigator.wakeLock.request( 'screen' );
			lock = acquired;
			acquired.addEventListener( 'release', () => {

				if ( lock === acquired ) lock = null;

			} );

			// The page may have been hidden while the request was pending.
			if ( document.visibilityState !== 'visible' ) await acquired.release();

		} catch {

			// Battery saving or browser policy can deny a lock. Retry on the
			// next interaction or return to the app, without interrupting it.

		} finally {

			pending = false;

		}

	}

	// Browsers automatically release screen locks when the page is hidden.
	document.addEventListener( 'visibilitychange', requestLock );
	window.addEventListener( 'pageshow', requestLock );
	document.addEventListener( 'pointerdown', requestLock, { passive: true } );
	document.addEventListener( 'keydown', requestLock );
	requestLock();

}
