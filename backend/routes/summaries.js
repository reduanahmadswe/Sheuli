import { Router } from 'express';
import { listSummaries } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const { limit, offset } = req.query;
  res.json(
    listSummaries({
      limit: limit ? Number(limit) : 30,
      offset: offset ? Number(offset) : 0
    })
  );
});

export default router;
