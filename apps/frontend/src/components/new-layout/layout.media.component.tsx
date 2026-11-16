'use client';

import { MediaBox } from '@gitroom/frontend/components/media/media.component';
import {
  LocalClipping,
  useLocalClippingJobs,
} from '@gitroom/frontend/components/media/local.clipping.component';
import { Button } from '@gitroom/react/form/button';
import { useState } from 'react';

export const MediaLayoutComponent = () => {
  const { data, mutate } = useLocalClippingJobs();
  const [showClipping, setShowClipping] = useState(false);
  return (
    <div className="bg-newBgColorInner p-[20px] flex flex-1 flex-col gap-[15px] transition-all">
      {data?.enabled && (
        <div className="flex flex-wrap gap-2">
          <Button
            secondary={showClipping}
            aria-pressed={!showClipping}
            onClick={() => setShowClipping(false)}
          >
            Biblioteca de mídia
          </Button>
          <Button
            secondary={!showClipping}
            aria-pressed={showClipping}
            onClick={() => setShowClipping(true)}
          >
            Clipagem inteligente
          </Button>
        </div>
      )}
      {data?.enabled && showClipping ? (
        <LocalClipping jobs={data.jobs} reload={mutate} />
      ) : (
        <MediaBox setMedia={() => {}} closeModal={() => {}} standalone={true} />
      )}
    </div>
  );
};
