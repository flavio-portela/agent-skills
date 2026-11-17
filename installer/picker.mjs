// The interactive picker for the skill installer: a single-pane ink app
// listing every skill in the repo, all pre-selected, with a fuzzy filter,
// select-all / deselect-all keys, and a key-map footer.
//
// The public seam is pickSkills(): give it the candidate list and it
// resolves with the picker's discriminated result:
//
//   {kind: 'selected', names} | {kind: 'empty'} | {kind: 'aborted'}
//
// The renderer defaults to ink. Tests supply ink-testing-library's renderer
// to drive this same function with simulated stdin, without a terminal.

import React, {useMemo, useState} from 'react';
import {html} from 'htm/react';
import {Box, Text, render, useInput, useWindowSize} from 'ink';

const FOOTER_LIST = '[↑/↓ j/k] move  [space] toggle  [a] select all  [x] deselect all  [/] filter  [enter] install  [esc/ctrl+c] abort';
const FOOTER_FILTER = '[backspace] delete  [enter] install  [esc] back to list  [ctrl+c] abort';

// Case-insensitive subsequence match: every character of the needle appears
// in the haystack, in order.
function isSubsequence(needle, haystack) {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return i === needle.length;
}

function Row({item, cursor, selected}) {
  return html`
    <${Text} color=${cursor ? 'cyan' : undefined} wrap="truncate">${`${cursor ? '>' : ' '} ${selected ? '[x]' : '[ ]'} ${item.name} (${item.bucket}) ${item.description}`}</${Text}>
  `;
}

function PickerApp({candidates, onResult}) {
  const [query, setQuery] = useState('');
  const [inFilter, setInFilter] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState(() => new Set(candidates.map(c => c.name)));

  const matches = useMemo(() => {
    const q = query.toLowerCase();
    if (q === '') return candidates;
    return candidates.filter(
      c => isSubsequence(q, c.name.toLowerCase()) || isSubsequence(q, c.description.toLowerCase()),
    );
  }, [candidates, query]);

  const clampedCursor = Math.min(cursor, Math.max(matches.length - 1, 0));
  const {rows, columns} = useWindowSize();
  const footer = inFilter ? FOOTER_FILTER : FOOTER_LIST;
  const visibleCount = Math.max(1, rows - Math.ceil(footer.length / columns) - 2);
  const start = Math.max(0, clampedCursor - visibleCount + 1);

  const confirm = () => {
    const names = candidates.filter(c => selected.has(c.name)).map(c => c.name);
    onResult(names.length === 0 ? {kind: 'empty'} : {kind: 'selected', names});
  };

  useInput((input, key) => {
    // Ctrl+c takes the abort path; ink's raw mode would otherwise swallow
    // it, so the app handles it explicitly.
    if (key.ctrl && input === 'c') {
      onResult({kind: 'aborted'});
      return;
    }
    if (key.escape) {
      if (inFilter) {
        setInFilter(false);
        return;
      }
      onResult({kind: 'aborted'});
      return;
    }
    if (inFilter) {
      // In the filter, typing is query editing only: no list actions.
      if (key.return) {
        confirm();
        return;
      }
      if (key.backspace || key.delete) {
        setQuery(q => q.slice(0, -1));
        return;
      }
      if (input.length === 1 && !key.ctrl && !key.meta) {
        setQuery(q => q + input);
      }
      return;
    }
    if (key.return) {
      confirm();
      return;
    }
    if (input === 'j' || key.downArrow) {
      setCursor(Math.max(0, Math.min(clampedCursor + 1, matches.length - 1)));
      return;
    }
    if (input === 'k' || key.upArrow) {
      setCursor(Math.max(clampedCursor - 1, 0));
      return;
    }
    if (input === ' ') {
      const item = matches[clampedCursor];
      if (!item) return;
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(item.name)) {
          next.delete(item.name);
        } else {
          next.add(item.name);
        }
        return next;
      });
      return;
    }
    if (input === 'a') {
      setSelected(new Set(candidates.map(c => c.name)));
      return;
    }
    if (input === 'x') {
      setSelected(new Set());
      return;
    }
    if (input === '/') {
      setInFilter(true);
    }
  });

  return html`
    <${Box} flexDirection="column">
      <${Text} bold wrap="truncate">${inFilter ? 'Filter: ' + query : 'Select skills to install' + (query ? '  (filter: ' + query + ')' : '')}</${Text}>
      <${Box} flexDirection="column">
        ${matches.slice(start, start + visibleCount).map((item, i) =>
          html`
            <${Row}
              key=${item.name}
              item=${item}
              cursor=${start + i === clampedCursor}
              selected=${selected.has(item.name)}
            />
          `
        )}
        ${matches.length === 0 ? html`<${Text} dimColor>No skills match the filter.</${Text}>` : null}
      </${Box}>
      <${Text} dimColor>${footer}</${Text}>
    </${Box}>
  `;
}

export function pickSkills({candidates}, renderApp = render) {
  return new Promise(resolveResult => {
    let settled = false;
    const {unmount} = renderApp(
      html`
        <${PickerApp}
          candidates=${candidates}
          onResult=${result => {
            if (!settled) {
              settled = true;
              unmount();
              resolveResult(result);
            }
          }}
        />
      `,
      {exitOnCtrlC: false},
    );
  });
}
