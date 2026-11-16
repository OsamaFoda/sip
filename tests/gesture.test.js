import test from 'node:test';
import assert from 'node:assert/strict';
import { pathRelatesTo } from '../lib/gesture.js';

// Fake nodes: just what pathRelatesTo uses.
function node(name, parent = null) {
  const n = { nodeType: 1, nodeName: name, parentNode: parent, children: [] };
  n.contains = other => { for (let x = other; x; x = x.parentNode) if (x === n) return true; return false; };
  if (parent) parent.children.push(n);
  return n;
}

test('a click on the player counts; one elsewhere on the page doesn\'t', () => {
  const doc = { nodeType: 9, nodeName: '#document', parentNode: null, children: [], contains: () => true };
  const html = node('HTML', doc);
  const body = node('BODY', html);
  const main = node('MAIN', body);
  const player = node('DIV', main);
  const video = node('VIDEO', player);
  const controls = node('DIV', player);
  const button = node('BUTTON', controls);
  const sidebar = node('NAV', body);
  const link = node('A', sidebar);
  const path = target => { const p = []; for (let x = target; x; x = x.parentNode) p.push(x); return p; };
  assert.ok(pathRelatesTo(video, path(button)), 'the play button');
  assert.ok(pathRelatesTo(video, path(video)), 'the video itself');
  assert.ok(!pathRelatesTo(video, path(link)), 'a link in the sidebar');
  assert.ok(!pathRelatesTo(video, [body, html, doc]), 'the page itself');
  assert.ok(!pathRelatesTo(video, []), 'no gesture');
});
