import assert from 'node:assert/strict';
import { classifyChatId, isIndividualChatId } from '../chatFilter.js';

const cases = [
  { id: '12345@g.us', expectSkip: 'skipped-group' },
  { id: '12345-67890@g.us', expectSkip: 'skipped-group' },
  { id: 'xyz@newsletter', expectSkip: 'skipped-channel' },
  { id: 'status@broadcast', expectSkip: 'skipped-status' },
  { id: '8801XXXXXXXXX@c.us', expectSkip: null },
  { id: '215487820632251@lid', expectSkip: null },
  { id: '120363012345678901@broadcast', expectSkip: 'skipped-broadcast' },
  { id: 'something-unrecognized', expectSkip: 'skipped-unknown-chat-type' }
];

let passed = 0;

for (const { id, expectSkip } of cases) {
  const result = classifyChatId(id);
  assert.equal(result, expectSkip, `classifyChatId("${id}") expected ${expectSkip}, got ${result}`);
  assert.equal(isIndividualChatId(id), expectSkip === null, `isIndividualChatId("${id}") mismatch`);
  passed += 1;
  console.log(`PASS  classifyChatId("${id}") -> ${result === null ? 'ALLOWED (individual chat)' : result}`);
}

console.log(`\n${passed}/${cases.length} chat-filter test cases passed.`);
