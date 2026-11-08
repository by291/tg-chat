import { useEffect, useRef } from 'react';
import styles from './ChecklistMessage.module.css';

// prettier-ignore
const COLORS = [
  '#ff8724',
  '#cd89d0',
  '#1e9aff',
  '#56ce6b',
  '#e8bc2c'
];
const PARTICLE_COUNT = 50;
const PARTICLE_SIZE = 4;
const SPEED_SCALE = 0.6;
const MIN_SPEED = 500;
const SPEED_SPREAD = 400;
const SPAWN_OFFSET = 10;
const SPAWN_SPREAD = 50;
const GRAVITY = 800;
const AIR_RESISTANCE = 0.98;
const MILLISECONDS_PER_SECOND = 1000;
const QUARTER_TURN = Math.PI / 2;
const FULL_TURN = Math.PI * 2;
const MAX_ROTATION_SPEED = 0.3;
const MIN_FLICKER_FREQUENCY = 0.05;
const FLICKER_SPREAD = 0.1;

interface Particle {
  left: number;
  top: number;
  velocityX: number;
  velocityY: number;
  color: string;
  isCircle: boolean;
  size: number;
  rotation: number;
  rotationSpeed: number;
  flickerFrequency: number;
}

function createParticles(bounds: DOMRect): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    const isLeft = i % 2 === 0;
    const baseAngle = isLeft ? -QUARTER_TURN / 2 : (-QUARTER_TURN * 3) / 2;
    const angle = baseAngle + ((Math.random() - 0.5) * Math.PI) / 3;
    const speed = (MIN_SPEED + Math.random() * SPEED_SPREAD) * SPEED_SCALE;
    particles.push({
      left: isLeft ? -SPAWN_OFFSET : bounds.width + SPAWN_OFFSET,
      top: bounds.height / 2 + (Math.random() - 0.5) * SPAWN_SPREAD,
      velocityX: Math.cos(angle) * speed,
      velocityY: Math.sin(angle) * speed,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      isCircle: Math.random() > 0.5,
      size: PARTICLE_SIZE * (1 + Math.random()),
      rotation: Math.random() * FULL_TURN,
      rotationSpeed: (Math.random() - 0.5) * MAX_ROTATION_SPEED,
      flickerFrequency: MIN_FLICKER_FREQUENCY + Math.random() * FLICKER_SPREAD,
    });
  }
  return particles;
}

function drawParticle(context: CanvasRenderingContext2D, particle: Particle, frame: number) {
  context.save();
  context.translate(particle.left, particle.top);
  context.rotate(particle.rotation);
  context.globalAlpha = 0.7 + 0.3 * Math.abs(Math.sin(frame * particle.flickerFrequency));
  context.fillStyle = particle.color;
  context.beginPath();
  if (particle.isCircle) {
    context.arc(0, 0, particle.size / 2, 0, FULL_TURN);
  } else {
    const width = particle.size / 2;
    const height = particle.size * 1.5;
    context.roundRect(-width / 2, -height / 2, width, height, width / 2);
  }
  context.fill();
  context.restore();
}

function celebrate(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = bounds.width * pixelRatio;
  canvas.height = bounds.height * pixelRatio;
  context.scale(pixelRatio, pixelRatio);
  let particles = createParticles(bounds);
  let previousTime = 0;
  let frameCount = 0;
  let animationFrame = 0;

  function advance(now: number) {
    const elapsed = previousTime ? (now - previousTime) / MILLISECONDS_PER_SECOND : 0;
    previousTime = now;
    frameCount += 1;
    context!.clearRect(0, 0, bounds.width, bounds.height);
    for (const particle of particles) {
      particle.velocityY += GRAVITY * elapsed;
      particle.velocityX *= AIR_RESISTANCE;
      particle.left += particle.velocityX * elapsed;
      particle.top += particle.velocityY * elapsed;
      particle.rotation += particle.rotationSpeed;
      drawParticle(context!, particle, frameCount);
    }
    particles = particles.filter((particle) => particle.top <= bounds.height + SPAWN_SPREAD);
    if (particles.length) {
      animationFrame = requestAnimationFrame(advance);
    }
  }

  animationFrame = requestAnimationFrame(advance);

  return () => {
    cancelAnimationFrame(animationFrame);
    context.clearRect(0, 0, bounds.width, bounds.height);
  };
}

/** Celebrate only a newly completed checklist, never restored or virtualized history. */
export function ChecklistCelebration({ isCompleted }: { isCompleted: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wasCompleted = useRef(isCompleted);
  useEffect(() => {
    const shouldCelebrate = isCompleted && !wasCompleted.current;
    wasCompleted.current = isCompleted;
    const shouldReduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (shouldCelebrate && !shouldReduceMotion && canvasRef.current) {
      return celebrate(canvasRef.current);
    }
  }, [isCompleted]);

  return <canvas ref={canvasRef} className={styles.celebration} aria-hidden="true" />;
}
