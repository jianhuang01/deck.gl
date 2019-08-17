// TODO merge with icon-layer/icon-manager
import {log} from '@deck.gl/core';

const MISSING_CHAR_WIDTH = 32;

export function nextPowOfTwo(number) {
  return Math.pow(2, Math.ceil(Math.log2(number)));
}

/**
 * Generate character mapping table or update from an existing mapping table
 * @param characterSet {Array|Set} new characters
 * @param getFontWidth {Function} function to get width of each character
 * @param fontHeight {Number} height of font
 * @param buffer {Number} buffer surround each character
 * @param maxCanvasWidth {Number} max width of font atlas
 * @param mapping {Object} old mapping table
 * @param xOffset {Number} x position of last character in old mapping table
 * @param yOffset {Number} y position of last character in old mapping table
 * @returns {{
 *   mapping: Object,
 *   xOffset: Number, x position of last character
 *   yOffset: Number, y position of last character in old mapping table
 *   canvasHeight: Number, height of the font atlas canvas, power of 2
 *  }}
 */
export function buildMapping({
  characterSet,
  getFontWidth,
  fontHeight,
  buffer,
  maxCanvasWidth,
  mapping = {},
  xOffset = 0,
  yOffset = 0
}) {
  let row = 0;
  // continue from x position of last character in the old mapping
  let x = xOffset;
  Array.from(characterSet).forEach((char, i) => {
    if (!mapping[char]) {
      // measure texts
      // TODO - use Advanced text metrics when they are adopted:
      // https://developer.mozilla.org/en-US/docs/Web/API/TextMetrics
      const width = getFontWidth(char, i);

      if (x + width + buffer * 2 > maxCanvasWidth) {
        x = 0;
        row++;
      }
      mapping[char] = {
        x: x + buffer,
        y: yOffset + row * (fontHeight + buffer * 2) + buffer,
        width,
        height: fontHeight,
        mask: true
      };
      x += width + buffer * 2;
    }
  });

  const rowHeight = fontHeight + buffer * 2;

  return {
    mapping,
    xOffset: x,
    yOffset: yOffset + row * rowHeight,
    canvasHeight: nextPowOfTwo(yOffset + (row + 1) * rowHeight)
  };
}

function getTextWidth(text, mapping) {
  const textArray = Array.from(text);
  let width = 0;
  for (let i = 0; i < textArray.length; i++) {
    const character = textArray[i];
    let frameWidth = null;
    const frame = mapping[character];
    if (frame) {
      frameWidth = frame.width;
    } else {
      log.warn(`Missing character: ${character}`)();
      frameWidth = MISSING_CHAR_WIDTH;
    }

    width += frameWidth;
  }

  return width;
}

function getTextGroups(text, wordBreak, iconMapping) {
  let groups = null;
  if (wordBreak === 'break-word') {
    groups = text.split(' ');
    let index = 0;
    return groups.map(g => {
      const characters = g || ' ';
      const group = {
        text: characters,
        startCharIndex: index,
        width: getTextWidth(characters, iconMapping)
      };

      // index increase 1 for white space
      index += characters.length + 1;
      return group;
    });
  }

  // otherwise break-all
  groups = Array.from(text);
  return groups.map((g, i) => {
    return {
      text: g,
      startCharIndex: i,
      width: getTextWidth(g, iconMapping)
    };
  });
}

export function autoWrapping({text, wordBreak, maxWidth, iconMapping}) {
  if (!text) {
    return null;
  }

  // 1. break text into groups
  const groups = getTextGroups(text, wordBreak, iconMapping);

  let rows = [];
  let startCharIndex = 0;
  let offsetLeft = 0;

  // 2. figure out where to break lines
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    let groupWidth = group.width;

    if (offsetLeft + groupWidth > maxWidth) {
      // next row
      rows.push(text.substring(startCharIndex, group.startCharIndex));
      startCharIndex = group.startCharIndex;
      offsetLeft = 0;

      // if a single group is bigger than maxWidth, then `break-all`
      if (groupWidth > maxWidth) {
        const subResults = autoWrapping({
          text: group.text,
          wordBreak: 'break-all',
          maxWidth,
          iconMapping
        });

        // add all the sub rows to results except last row
        rows = rows.concat(subResults.rows.slice(0, subResults.rows.length - 1));
        startCharIndex = startCharIndex + subResults.startCharIndex;
        groupWidth = subResults.offsetLeft;
      }
    }

    offsetLeft += groupWidth;
  }

  // last row
  rows.push(text.substring(startCharIndex));

  return {
    rows,
    startCharIndex,
    offsetLeft
  };
}

export function transformRow({row, iconMapping, lineHeight, rowOffsetTop}) {
  let offsetLeft = 0;
  let rowHeight = 0;

  let characters = Array.from(row);

  characters = characters.map(character => {
    const datum = {
      text: character,
      offsetTop: rowOffsetTop,
      offsetLeft
    };

    const frame = iconMapping[character];
    if (frame) {
      if (!rowHeight) {
        // frame.height should be a constant
        rowHeight = frame.height * lineHeight;
      }
      offsetLeft += frame.width;
    } else {
      log.warn(`Missing character: ${character}`)();
      offsetLeft += MISSING_CHAR_WIDTH;
    }

    return datum;
  });

  return {
    characters,
    rowWidth: offsetLeft,
    rowHeight
  };
}

/**
 * Transform a text paragraph to an array of characters, each character contains
 * @param props:
 *   - paragraph {String}
 *   - iconMapping {Object} character mapping table for retrieving a character from font atlas
 *   - transformCharacter {Function} callback to transform a single character
 *   - lineHeight {Number} css line-height
 *   - wordBreak {String} css word-break option
 *   - maxWidth {number} css max-width of sizethe element
 * @param transformedData {Array} output transformed data array, each datum contains
 *   - text: character
 *   - index: character index in the paragraph
 *   - offsetLeft: x offset in the row,
 *   - offsetTop: y offset in the paragraph
 *   - size: [width, height] size of the paragraph
 *   - rowSize: [rowWidth, rowHeight] size of the row
 *   - len: length of the paragraph
 */
export function transformParagraph(
  {
    paragraph,
    iconMapping,
    transformCharacter,
    // styling
    lineHeight,
    wordBreak,
    maxWidth
  },
  transformedData = []
) {
  if (!paragraph) {
    return;
  }

  const wordBreakEnabled = wordBreak && maxWidth;

  // maxWidth and height of the paragraph
  const size = [0, 0];
  let rowOffsetTop = 0;

  paragraph.split('\n').forEach(line => {
    let rows = [line];
    if (wordBreakEnabled) {
      const wrapped = autoWrapping({text: line, wordBreak, maxWidth, iconMapping});
      rows = wrapped.rows;
    }

    rows.forEach(row => {
      const {rowWidth, rowHeight, characters} = transformRow({
        row,
        iconMapping,
        lineHeight,
        maxWidth,
        rowOffsetTop
      });

      const rowSize = [rowWidth, rowHeight];

      characters.forEach(datum => {
        datum.size = size;
        datum.rowSize = rowSize;
        transformedData.push(transformCharacter(datum));
      });

      rowOffsetTop = rowOffsetTop + rowHeight;
      size[0] = wordBreakEnabled ? maxWidth : Math.max(size[0], rowWidth);
    });
  });

  // last row
  size[1] = rowOffsetTop;
}
