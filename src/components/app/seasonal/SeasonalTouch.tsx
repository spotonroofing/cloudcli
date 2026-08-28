import { useEffect, useState } from 'react';

import { getSeasonalMoment } from './seasonalDate';

function millisecondsUntilTomorrow(now: Date): number {
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 1, 0);
  return Math.max(1_000, tomorrow.getTime() - now.getTime());
}

function useCurrentDate(fixedDate?: Date): Date {
  const [currentDate, setCurrentDate] = useState(() => fixedDate ?? new Date());

  useEffect(() => {
    if (fixedDate) {
      return;
    }

    let timer = 0;
    const scheduleNextDay = () => {
      const now = new Date();
      setCurrentDate(now);
      timer = window.setTimeout(scheduleNextDay, millisecondsUntilTomorrow(now));
    };

    timer = window.setTimeout(scheduleNextDay, millisecondsUntilTomorrow(new Date()));
    return () => window.clearTimeout(timer);
  }, [fixedDate]);

  return fixedDate ?? currentDate;
}

function AprilTouch() {
  return (
    <>
      <span className="seasonal-april-mark seasonal-april-mark--one">[</span>
      <span className="seasonal-april-mark seasonal-april-mark--two">^</span>
      <span className="seasonal-april-mark seasonal-april-mark--three">]</span>
    </>
  );
}

function SeptemberTouch() {
  return (
    <div className="seasonal-september-cluster">
      <span className="seasonal-glint seasonal-glint--one" />
      <span className="seasonal-glint seasonal-glint--two" />
      <span className="seasonal-glint seasonal-glint--three" />
      <span className="seasonal-five">5</span>
    </div>
  );
}

function HalloweenTouch() {
  return (
    <div className="seasonal-halloween-sky">
      <span className="seasonal-moon" />
      <svg className="seasonal-bat seasonal-bat--one" viewBox="0 0 32 12">
        <path d="M1 9c4-7 9-7 15-1 6-6 11-6 15 1-5-2-8 0-9 3-2-2-4-3-6-3s-4 1-6 3C9 9 6 7 1 9Z" />
      </svg>
      <svg className="seasonal-bat seasonal-bat--two" viewBox="0 0 32 12">
        <path d="M1 9c4-7 9-7 15-1 6-6 11-6 15 1-5-2-8 0-9 3-2-2-4-3-6-3s-4 1-6 3C9 9 6 7 1 9Z" />
      </svg>
    </div>
  );
}

const SNOWFLAKES = [
  ['7%', '0.55rem', '0s'],
  ['18%', '0.3rem', '-2.1s'],
  ['31%', '0.42rem', '-4.4s'],
  ['47%', '0.26rem', '-1.2s'],
  ['62%', '0.48rem', '-5.3s'],
  ['76%', '0.32rem', '-3.5s'],
  ['91%', '0.4rem', '-6.2s'],
] as const;

function WinterTouch() {
  return (
    <div className="seasonal-winter-sky">
      {SNOWFLAKES.map(([left, size, delay]) => (
        <span
          key={left}
          className="seasonal-snowflake"
          style={{ left, width: size, height: size, animationDelay: delay }}
        />
      ))}
      <span className="seasonal-winter-star" />
    </div>
  );
}

type SeasonalTouchProps = {
  now?: Date;
};

export default function SeasonalTouch({ now }: SeasonalTouchProps) {
  const moment = getSeasonalMoment(useCurrentDate(now));
  if (!moment) return null;

  return (
    <div
      aria-hidden="true"
      className={`seasonal-touch seasonal-touch--${moment}`}
      data-seasonal-moment={moment}
      data-slot="seasonal-touch"
    >
      {moment === 'april' && <AprilTouch />}
      {moment === 'september' && <SeptemberTouch />}
      {moment === 'halloween' && <HalloweenTouch />}
      {moment === 'winter' && <WinterTouch />}
    </div>
  );
}
