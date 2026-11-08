import { useLayoutEffect, useState, type RefObject } from 'react';
import type { Message } from '@/features/chat/model';
import { ViewerPhoto } from './ViewerPhoto';
import { ViewerVideo } from './ViewerVideo';

interface ViewerGalleryProps {
  message: Message;
  isOpen: boolean;
  activeIndex: number;
  mediaElementRef?: RefObject<HTMLDivElement | null>;
  onBusyChange?: (isBusy: boolean) => void;
}

/** Retain outgoing media at its own dimensions until the incoming slide has settled. */
export function ViewerGallery({
  message,
  isOpen,
  activeIndex,
  mediaElementRef,
  onBusyChange,
}: ViewerGalleryProps) {
  const [slides, setSlides] = useState({
    current: message,
    previous: undefined as Message | undefined,
    index: activeIndex,
    direction: 0,
    isSettled: false,
  });

  useLayoutEffect(() => {
    if (message.id !== slides.current.id) {
      setSlides({
        current: message,
        previous: slides.current,
        index: activeIndex,
        direction: Math.sign(activeIndex - slides.index),
        isSettled: false,
      });
    }
  }, [message, activeIndex, slides]);

  useLayoutEffect(() => {
    onBusyChange?.(!slides.isSettled);
  }, [slides.isSettled, onBusyChange]);

  function settle() {
    setSlides((current) => ({
      ...current,
      previous: undefined,
      isSettled: true,
    }));
  }

  let activePhase: 'idle' | 'opening' | 'entering' = 'opening';
  if (slides.isSettled) {
    activePhase = 'idle';
  } else if (slides.previous) {
    activePhase = 'entering';
  }
  const visibleSlides = slides.previous ? [slides.previous, slides.current] : [slides.current];

  return visibleSlides.map((entry) => {
    const isActive = entry.id === slides.current.id;
    const Viewer = entry.attachment ? ViewerPhoto : ViewerVideo;
    return (
      <Viewer
        key={entry.id}
        message={entry}
        isOpen={isOpen}
        activeIndex={activeIndex}
        phase={isActive ? activePhase : 'leaving'}
        direction={slides.direction}
        onSettled={isActive ? settle : undefined}
        positionerRef={isActive ? mediaElementRef : undefined}
      />
    );
  });
}
