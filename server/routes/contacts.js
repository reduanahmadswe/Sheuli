import { Router } from 'express';
import { listContacts, setContactFlag, getContact, clearContactMemory } from '../db.js';
import { syncContactsFromWhatsApp } from '../whatsapp.js';

const router = Router();

router.get('/', (req, res) => {
  const { search = '' } = req.query;
  res.json(listContacts(search));
});

router.post('/sync', async (req, res) => {
  const result = await syncContactsFromWhatsApp();
  if (!result.ok) {
    return res.status(400).json({ error: result.error || 'Failed to sync contacts' });
  }
  return res.json(result);
});

router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const { blacklisted, whitelisted } = req.body || {};

  if (!getContact(id)) {
    return res.status(404).json({ error: 'Contact not found' });
  }

  let contact;
  if (typeof blacklisted === 'boolean') {
    contact = setContactFlag(id, 'blacklisted', blacklisted);
  }
  if (typeof whitelisted === 'boolean') {
    contact = setContactFlag(id, 'whitelisted', whitelisted);
  }

  return res.json(contact || getContact(id));
});

router.post('/:id/clear-memory', (req, res) => {
  const { id } = req.params;

  if (!getContact(id)) {
    return res.status(404).json({ error: 'Contact not found' });
  }

  const contact = clearContactMemory(id);
  return res.json(contact);
});

export default router;
