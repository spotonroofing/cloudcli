import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import SeasonalTouch from './SeasonalTouch';
import { getSeasonalMoment, type SeasonalMoment } from './seasonalDate';

const localDate = (month: number, day: number) => new Date(2026, month - 1, day, 12, 0, 0);

const windows: Array<{
  moment: SeasonalMoment;
  active: Date[];
  inactive: Date[];
}> = [
  { moment: 'april', active: [localDate(4, 1)], inactive: [localDate(3, 31), localDate(4, 2)] },
  { moment: 'september', active: [localDate(9, 5)], inactive: [localDate(9, 4), localDate(9, 6)] },
  { moment: 'halloween', active: [localDate(10, 31)], inactive: [localDate(10, 30), localDate(11, 1)] },
  {
    moment: 'winter',
    active: [localDate(12, 1), localDate(12, 25), localDate(1, 6)],
    inactive: [localDate(11, 30), localDate(1, 7)],
  },
];

for (const window of windows) {
  test(`${window.moment} renders only inside its date window`, () => {
    for (const date of window.active) {
      assert.equal(getSeasonalMoment(date), window.moment);
      const markup = renderToStaticMarkup(<SeasonalTouch now={date} />);
      assert.match(markup, new RegExp(`data-seasonal-moment="${window.moment}"`));
      assert.match(markup, /data-slot="seasonal-touch"/);
    }

    for (const date of window.inactive) {
      assert.notEqual(getSeasonalMoment(date), window.moment);
    }
  });
}

test('an ordinary day renders no seasonal layer', () => {
  const date = localDate(8, 27);
  assert.equal(getSeasonalMoment(date), null);
  assert.equal(renderToStaticMarkup(<SeasonalTouch now={date} />), '');
});
