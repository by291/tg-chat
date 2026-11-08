import { useEffect, useRef, useState } from 'react';
import styles from './Ripple.module.css';

const DEFAULT_DURATION = 700;
const MILLISECONDS_PER_SECOND = 1000;

interface RippleWave {
  id: number;
  left: number;
  top: number;
  size: number;
  isFading: boolean;
}

interface RippleOrigin {
  clientX: number;
  clientY: number;
}

/** Add press feedback to the immediate parent without taking over its click or focus behavior. */
export function Ripple() {
  const layerRef = useRef<HTMLSpanElement>(null);
  const [waves, setWaves] = useState<RippleWave[]>([]);

  useEffect(() => {
    const mountedLayer = layerRef.current;
    const parent = mountedLayer?.parentElement;
    if (!mountedLayer || !parent) {
      return;
    }

    const layer = mountedLayer;
    const control = parent;
    let nextId = 0;
    let releasePress: (() => void) | undefined;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const listeners = new AbortController();

    function schedule(callback: () => void, delay: number) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        callback();
      }, delay);
      timers.add(timer);
    }

    function beginPress(origin: RippleOrigin) {
      const isDisabled = control.matches(':disabled, [aria-disabled="true"]');
      if (isDisabled || releasePress) {
        return;
      }

      const bounds = layer.getBoundingClientRect();
      const offsetX = origin.clientX - bounds.left;
      const offsetY = origin.clientY - bounds.top;
      const farthestX = Math.max(offsetX, bounds.width - offsetX);
      const farthestY = Math.max(offsetY, bounds.height - offsetY);
      const size = Math.hypot(farthestX, farthestY);

      const durationValue = getComputedStyle(layer).getPropertyValue('--ripple-duration');
      const durationSeconds = Number.parseFloat(durationValue);
      const hasValidDuration = Number.isFinite(durationSeconds) && durationSeconds > 0;
      const duration = hasValidDuration
        ? durationSeconds * MILLISECONDS_PER_SECOND
        : DEFAULT_DURATION;

      const startedAt = performance.now();
      const pressListeners = new AbortController();
      const id = nextId;
      nextId += 1;

      const wave: RippleWave = {
        id,
        left: offsetX - size / 2,
        top: offsetY - size / 2,
        size,
        isFading: false,
      };
      setWaves((current) => [...current, wave]);

      function release() {
        pressListeners.abort();
        releasePress = undefined;

        const elapsed = performance.now() - startedAt;
        const fadeDelay = Math.max(duration / 2 - elapsed, 0);

        // A quick tap still shows the expansion; a held press fades only after release.
        schedule(() => {
          setWaves((current) =>
            current.map((wave) => {
              if (wave.id === id) {
                return { ...wave, isFading: true };
              }

              return wave;
            }),
          );
        }, fadeDelay);
        schedule(
          () => {
            setWaves((current) => current.filter((wave) => wave.id !== id));
          },
          fadeDelay + duration / 2,
        );
      }

      releasePress = release;
      const options = { signal: pressListeners.signal, capture: true };
      window.addEventListener('pointerup', release, options);
      window.addEventListener('pointercancel', release, options);
      window.addEventListener('blur', release, options);
      control.addEventListener('pointerleave', release, options);
      control.addEventListener('blur', release, options);
      window.addEventListener(
        'keyup',
        (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            release();
          }
        },
        options,
      );
    }

    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0) {
        return;
      }

      beginPress({ clientX: event.clientX, clientY: event.clientY });
    }

    function onKeyDown(event: KeyboardEvent) {
      const isActivationKey = event.key === 'Enter' || event.key === ' ';
      if (!isActivationKey || event.repeat || event.target !== control) {
        return;
      }

      const bounds = layer.getBoundingClientRect();
      beginPress({
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
      });
    }

    control.addEventListener('pointerdown', onPointerDown, { signal: listeners.signal });
    control.addEventListener('keydown', onKeyDown, { signal: listeners.signal });

    return () => {
      listeners.abort();
      releasePress?.();

      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, []);

  return (
    <span ref={layerRef} className={styles.layer} aria-hidden="true">
      {waves.map((wave) => (
        <span
          key={wave.id}
          className={styles.wave}
          data-fading={wave.isFading}
          style={{
            left: wave.left,
            top: wave.top,
            width: wave.size,
            height: wave.size,
          }}
        />
      ))}
    </span>
  );
}
