import { Router } from 'express';
import { getChats, getContactMessages, getContact, markContactRead } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const { search = '' } = req.query;
  res.json(getChats(search));
});

router.get('/:contactId/messages', (req, res) => {
  const { contactId } = req.params;
  const { before, limit } = req.query;

  if (!getContact(contactId)) {
    return res.status(404).json({ error: 'Contact not found' });
  }

  const messages = getContactMessages(contactId, {
    limit: limit ? Number(limit) : 50,
    beforeId: before ? Number(before) : undefined
  });
  return res.json(messages);
});

router.post('/:contactId/read', (req, res) => {
  const { contactId } = req.params;

  if (!getContact(contactId)) {
    return res.status(404).json({ error: 'Contact not found' });
  }

  markContactRead(contactId);
  return res.json({ ok: true });
});

export default router;
