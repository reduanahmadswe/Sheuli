import config from './config.js';
import { getCurrentRunningCalendarEvent } from './services/googleCalendar.js';

export const MODES = {
  normal: { id: 'normal', name: 'Normal 🌸', icon: '🌸', description: 'Standard personal AI assistant' },
  sleep: { id: 'sleep', name: 'Sleep 🌙', icon: '🌙', description: 'Sleeping (Midnight to Morning gatekeeper)' },
  home: { id: 'home', name: 'At Home 🏡', icon: '🏡', description: 'At family home / hometown' },
  commute: { id: 'commute', name: 'Commute 🚌', icon: '🚌', description: 'On bus, train, or in transit' },
  shopping: { id: 'shopping', name: 'Shopping 🛒', icon: '🛒', description: 'Out shopping / at the market' },
  adda: { id: 'adda', name: 'Adda ☕', icon: '☕', description: 'Hanging out / adda with friends' },
  movie: { id: 'movie', name: 'Movie 🎬', icon: '🎬', description: 'Watching a movie / show' },
  barber: { id: 'barber', name: 'Salon 💈', icon: '💈', description: 'At salon / barber shop' },
  errands: { id: 'errands', name: 'Errands 🏃', icon: '🏃', description: 'Out running personal errands' },
  lowbat: { id: 'lowbat', name: 'Low Battery 🪫', icon: '🪫', description: 'Phone battery low / about to die' },
  class: { id: 'class', name: 'Class 🏫', icon: '🏫', description: 'Attending university class' },
  study: { id: 'study', name: 'Study 📚', icon: '📚', description: 'Deep focus study session' },
  exam: { id: 'exam', name: 'Exam 📝', icon: '📝', description: 'Exams in progress — silent mode' },
  lab: { id: 'lab', name: 'Lab 🔬', icon: '🔬', description: 'University lab experiment/session' },
  meeting: { id: 'meeting', name: 'Meeting 💼', icon: '💼', description: 'In a meeting or project discussion' },
  coding: { id: 'coding', name: 'Coding 💻', icon: '💻', description: 'Deep programming & software work' },
  dnd: { id: 'dnd', name: 'DND 🛑', icon: '🛑', description: 'Do Not Disturb / Digital Detox' },
  prayer: { id: 'prayer', name: 'Prayer 🕌', icon: '🕌', description: 'Prayer / Namaz / Jummah' },
  dining: { id: 'dining', name: 'Dining 🍽️', icon: '🍽️', description: 'Eating lunch/dinner or family meal' },
  resting: { id: 'resting', name: 'Resting 🤒', icon: '🤒', description: 'Sick or resting at home' },
  driving: { id: 'driving', name: 'Driving 🚗', icon: '🚗', description: 'Driving or commuting' },
  workout: { id: 'workout', name: 'Gym 🏋️', icon: '🏋️', description: 'Working out at gym / exercise' },
  gaming: { id: 'gaming', name: 'Gaming 🎮', icon: '🎮', description: 'Gaming or esports session' },
  travel: { id: 'travel', name: 'Travel ✈️', icon: '✈️', description: 'Travelling or on a vacation/tour' },
  medical: { id: 'medical', name: 'Medical 🏥', icon: '🏥', description: 'At doctor appointment or hospital' },
  rainy: { id: 'rainy', name: 'Rainy/Jam 🌧️', icon: '🌧️', description: 'Stuck in heavy rain or traffic jam' },
  party: { id: 'party', name: 'Party 🎉', icon: '🎉', description: 'At a wedding, party or event' },
  teabreak: { id: 'teabreak', name: 'Tea Break 🫖', icon: '🫖', description: 'Short 10-min tea/coffee break' },
  chores: { id: 'chores', name: 'Chores 🧹', icon: '🧹', description: 'Doing house chores or cleaning' },
  oncall: { id: 'oncall', name: 'On Call 📞', icon: '📞', description: 'On a phone call with someone' },
  charging: { id: 'charging', name: 'Charging 🔌', icon: '🔌', description: 'Phone charging away from hands' },
  reading: { id: 'reading', name: 'Reading 📖', icon: '📖', description: 'Reading a book or novel' },
  outdoors: { id: 'outdoors', name: 'Outdoors 🏕️', icon: '🏕️', description: 'Outdoors, park or camping' },
  thinking: { id: 'thinking', name: 'Thinking 🧠', icon: '🧠', description: 'Deep thinking & strategy planning' }
};

export const EMERGENCY_KEYWORDS = [
  'emergency', 'urgent', 'জরুরি', 'জরুরী', 'বিপদ', 'অসুস্থ', 'হাসপাতাল', 'call de', 'call me', 'kol de', 'kol me'
];

export function isEmergencyMessage(text = '') {
  const normalized = text.toLowerCase();
  return EMERGENCY_KEYWORDS.some((kw) => normalized.includes(kw));
}

export function getCurrentActivity(settings = {}, db = null, now = new Date()) {
  const timezone = settings.timezone || config.timezone;

  // 1st PRIORITY: Live ongoing Calendar Event
  if (db) {
    const runningCal = getCurrentRunningCalendarEvent(db, now);
    if (runningCal) {
      const sDate = new Date(runningCal.start_time).toLocaleTimeString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit'
      });
      const eDate = new Date(runningCal.end_time).toLocaleTimeString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit'
      });
      return {
        priority: 1,
        type: 'calendar',
        mode: 'calendar',
        title: runningCal.summary,
        description: runningCal.description || '',
        startTime: sDate,
        endTime: eDate,
        details: `Busy with: ${runningCal.summary} (${sDate} - ${eDate})`,
        calendarEvent: runningCal
      };
    }
  }

  // 2nd PRIORITY: Active Mode (if not 'normal')
  const activeMode = settings.activeMode || 'normal';
  if (activeMode !== 'normal') {
    const modeInfo = MODES[activeMode] || MODES.normal;
    return {
      priority: 2,
      type: 'mode',
      mode: activeMode,
      title: modeInfo.name,
      info: modeInfo,
      details: modeInfo.description
    };
  }

  // 3rd PRIORITY: Normal Assistant Mode
  return {
    priority: 3,
    type: 'normal',
    mode: 'normal',
    title: 'Normal 🌸',
    info: MODES.normal,
    details: 'Normal Assistant Mode 🌸. Away from phone right now.'
  };
}

export function getActiveModeDetails(settings, db = null, now = new Date()) {
  const activity = getCurrentActivity(settings, db, now);
  if (activity.type === 'calendar') {
    return {
      mode: 'calendar',
      info: { id: 'calendar', name: 'Calendar Event 📅', icon: '📅', description: activity.details },
      details: activity.details,
      activity
    };
  }
  const modeInfo = MODES[activity.mode] || MODES.normal;
  return {
    mode: activity.mode,
    info: modeInfo,
    details: modeInfo.description,
    activity
  };
}

export function getActivitySystemInstruction(activity, settings = {}) {
  if (!activity) {
    return 'CURRENT STATUS & INSTRUCTION: Normal Assistant Mode 🌸. Reduan is away from his phone right now.';
  }

  if (activity.type === 'calendar') {
    return (
      `CRITICAL TOP PRIORITY - CURRENT LIVE CALENDAR ACTIVITY (MUST MENTION):\n` +
      `Reduan is CURRENTLY busy with: "${activity.title}" (from ${activity.startTime} to ${activity.endTime}).\n` +
      `INSTRUCTION: You MUST politely, warmly, and clearly state to the sender that Reduan is currently busy with "${activity.title}" and will be available after ${activity.endTime}. Do not make any promises on his behalf.`
    );
  }

  // Fallback to mode instruction
  return getModeSystemInstruction({ mode: activity.mode }, settings);
}


export function getModeSystemInstruction(modeDetails, settings = {}) {
  const { mode } = modeDetails;

  const customKey = `modePrompt_${mode}`;
  if (settings && settings[customKey]) {
    return `CURRENT MODE INSTRUCTION (${mode.toUpperCase()} MODE):\n${settings[customKey]}`;
  }

  switch (mode) {
    case 'sleep':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is currently SLEEPING 🌙 (Sleep Mode).\n' +
        'Inform the sender warmly that Reduan is asleep and will reply in the morning.\n' +
        'If it is an URGENT emergency, tell them to reply with the word "EMERGENCY" to alert Reduan.'
      );
    case 'home':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is AT HOME / HOMETOWN 🏡 spending time with family.\n' +
        'Inform the sender warmly that Reduan is at home with family and will reply when free.'
      );
    case 'commute':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is COMMUTING 🚌 (on bus, train or in transit).\n' +
        'Inform the sender politely that Reduan is in transit/on the move and will check messages after reaching.'
      );
    case 'shopping':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is SHOPPING / AT THE MARKET 🛒.\n' +
        'Inform the sender politely that Reduan is out shopping and will check messages after finishing.'
      );
    case 'adda':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is HANGING OUT / ADDA WITH FRIENDS ☕.\n' +
        'Inform the sender in a friendly tone that Reduan is hanging out with friends and will reply shortly.'
      );
    case 'movie':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is WATCHING A MOVIE / SHOW 🎬.\n' +
        'Inform the sender politely that Reduan is watching a movie and will reply after the show ends.'
      );
    case 'barber':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is AT THE SALON / BARBER 💈.\n' +
        'Inform the sender politely that Reduan is at the salon and will check messages soon.'
      );
    case 'errands':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is OUT RUNNING PERSONAL ERRANDS 🏃.\n' +
        'Inform the sender politely that Reduan is busy outside with errands and will reply after returning.'
      );
    case 'lowbat':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan\'s PHONE BATTERY IS VERY LOW 🪫.\n' +
        'Inform the sender that Reduan\'s phone is about to die/charging, so responses might be delayed until charged.'
      );
    case 'medical':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is AT A MEDICAL APPOINTMENT / HOSPITAL 🏥.\n' +
        'Inform the sender politely that Reduan is at a doctor appointment/hospital and will reply when free.'
      );
    case 'rainy':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is STUCK IN HEAVY RAIN / TRAFFIC JAM 🌧️.\n' +
        'Inform the sender politely that Reduan is stuck in rain/traffic and will check messages after getting to safety.'
      );
    case 'party':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is AT A WEDDING / PARTY / EVENT 🎉.\n' +
        'Inform the sender politely that Reduan is attending an event/party and will reply after the event.'
      );
    case 'teabreak':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is ON A SHORT TEA BREAK 🫖.\n' +
        'Inform the sender warmly that Reduan is taking a 10-min tea break and will reply shortly.'
      );
    case 'chores':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is BUSY WITH HOUSE CHORES / CLEANING 🧹.\n' +
        'Inform the sender politely that Reduan is busy with house chores and will check messages after finishing.'
      );
    case 'oncall':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is ON ANOTHER PHONE CALL 📞.\n' +
        'Inform the sender politely that Reduan is currently on a phone call and will reply after hanging up.'
      );
    case 'charging':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan\'s PHONE IS CHARGING AWAY 🔌.\n' +
        'Inform the sender that Reduan\'s phone is charging in another room and he will check messages when back at the desk.'
      );
    case 'reading':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is READING A BOOK / NOVEL 📖.\n' +
        'Inform the sender politely that Reduan is quietly reading and will reply after taking a break.'
      );
    case 'outdoors':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is OUTDOORS / AT A PARK 🏕️.\n' +
        'Inform the sender warmly that Reduan is outdoors enjoying nature and will reply when back.'
      );
    case 'thinking':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is BRAINSHORMING / STRATEGY THINKING 🧠.\n' +
        'Inform the sender politely that Reduan is deep in thought/planning and will get back to them when free.'
      );
    case 'class':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is currently in CLASS 🏫.\n' +
        'Inform the sender politely that Reduan is attending class right now and will check messages once class ends.'
      );
    case 'study':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is in FOCUS / STUDY MODE 📚.\n' +
        'Politely inform the sender that Reduan is currently studying/focusing and will get back to them when free.'
      );
    case 'exam':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan has EXAMS 📝 today.\n' +
        'Politely inform the sender that Reduan is currently taking exams and will reply after exams are completed.'
      );
    case 'lab':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is currently in a UNIVERSITY LAB SESSION 🔬.\n' +
        'Inform the sender politely that Reduan is conducting a lab experiment and cannot respond immediately.'
      );
    case 'meeting':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is in an IMPORTANT MEETING 💼.\n' +
        'Inform the sender politely that Reduan is in a meeting and will reply as soon as the meeting finishes.'
      );
    case 'coding':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is in DEEP CODING MODE 💻.\n' +
        'Politely inform the sender that Reduan is programming/debugging and will check messages after completing the sprint.'
      );
    case 'dnd':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is in DO NOT DISTURB / DIGITAL DETOX 🛑.\n' +
        'Politely inform the sender that Reduan is away from screens right now. Ask them to leave a message.'
      );
    case 'prayer':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is currently in PRAYER / NAMAZ 🕌.\n' +
        'Inform the sender warmly that Reduan is praying right now and will reply right after prayer.'
      );
    case 'dining':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is currently HAVING DINNER / MEAL 🍽️.\n' +
        'Inform the sender warmly that Reduan is eating and will reply after finishing the meal.'
      );
    case 'resting':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is RESTING / UNWELL 🤒.\n' +
        'Inform the sender warmly that Reduan is resting and will reach out when feeling better.'
      );
    case 'driving':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is DRIVING / COMMUTING 🚗.\n' +
        'Politely inform the sender that Reduan is driving and will check messages after reaching the destination safely.'
      );
    case 'workout':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is AT THE GYM / WORKING OUT 🏋️.\n' +
        'Inform the sender that Reduan is exercising and will reply after the workout.'
      );
    case 'gaming':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is in a GAMING / CHILL SESSION 🎮.\n' +
        'Inform the sender in a friendly tone that Reduan is gaming and will reply shortly.'
      );
    case 'travel':
      return (
        'CURRENT STATUS & INSTRUCTION: Reduan is TRAVELLING / ON TOUR ✈️.\n' +
        'Inform the sender warmly that Reduan is traveling and responses might be slightly delayed.'
      );
    case 'normal':
    default:
      return 'CURRENT STATUS & INSTRUCTION: Normal Assistant Mode 🌸. Reduan is away from his phone right now.';
  }
}

export default {
  MODES,
  EMERGENCY_KEYWORDS,
  isEmergencyMessage,
  getCurrentActivity,
  getActiveModeDetails,
  getModeSystemInstruction,
  getActivitySystemInstruction
};
