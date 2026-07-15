import { Router } from 'express';
import { getLogs } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const { status, contactId, limit, offset } = req.query;
  const logs = getLogs({
    status: status || undefined,
    contactId: contactId || undefined,
    limit: limit ? Number(limit) : 200,
    offset: offset ? Number(offset) : 0
  });
  res.json(logs);
});

export default router;
