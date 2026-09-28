"use strict";
// Built-in exercise library. Ids are stable ("ex-l-" + slug) so the same exercise merges across phone, backups and the Mac archive.
// Bump LIBRARY_VERSION when entries are added; existing rows are never overwritten.
const LIBRARY_VERSION = 1;
const LIBRARY = {
  "Göğüs": [
    "Incline Bench Press", "Decline Bench Press", "Dumbbell Bench Press", "Decline Dumbbell Press", "Smith Machine Bench Press",
    "Smith Machine Incline Bench Press", "Machine Chest Press", "Incline Machine Chest Press", "Hammer Strength Chest Press",
    "Cable Fly", "Low-to-High Cable Fly", "High-to-Low Cable Fly", "Incline Cable Fly", "Dumbbell Fly", "Incline Dumbbell Fly",
    "Pec Deck", "Push-up", "Weighted Push-up", "Deficit Push-up", "Chest Dip", "Machine Dip", "Floor Press",
  ],
  "Sırt": [
    "Chin-up", "Neutral-Grip Pull-up", "Weighted Pull-up", "Assisted Pull-up", "Wide-Grip Lat Pulldown", "Close-Grip Lat Pulldown",
    "Neutral-Grip Lat Pulldown", "Single-Arm Lat Pulldown", "Straight-Arm Pulldown", "Machine Pullover", "Dumbbell Pullover",
    "Pendlay Row", "Yates Row", "Dumbbell Row", "Chest-Supported Dumbbell Row", "Chest-Supported Machine Row", "T-Bar Row",
    "Seal Row", "Seated Cable Row", "Wide-Grip Cable Row", "Single-Arm Cable Row", "Machine Row", "Hammer Strength Row",
    "Meadows Row", "Inverted Row", "Rack Pull", "Trap Bar Deadlift", "Hyperextension", "Barbell Shrug", "Dumbbell Shrug", "Machine Shrug",
  ],
  "Omuz": [
    "Dumbbell Shoulder Press", "Seated Dumbbell Shoulder Press", "Arnold Press", "Machine Shoulder Press", "Smith Machine Shoulder Press",
    "Push Press", "Landmine Press", "Cable Lateral Raise", "Machine Lateral Raise", "Seated Lateral Raise", "Lean-Away Lateral Raise",
    "Y-Raise", "Front Raise", "Cable Front Raise", "Plate Front Raise", "Rear Delt Fly", "Reverse Pec Deck", "Cable Rear Delt Fly",
    "Face Pull", "Upright Row", "Cable Upright Row", "Rear Delt Row",
  ],
  "Biceps": [
    "Barbell Curl", "EZ-Bar Curl", "Dumbbell Curl", "Alternating Dumbbell Curl", "Hammer Curl", "Cross-Body Hammer Curl",
    "Incline Dumbbell Curl", "Preacher Curl", "Machine Preacher Curl", "Spider Curl", "Concentration Curl", "Cable Curl",
    "Bayesian Cable Curl", "Rope Hammer Curl", "Machine Curl", "Drag Curl",
  ],
  "Triceps": [
    "Rope Pushdown", "V-Bar Pushdown", "Straight-Bar Pushdown", "Single-Arm Cable Pushdown", "Cable Overhead Extension",
    "Overhead Dumbbell Extension", "EZ-Bar Skull Crusher", "Dumbbell Skull Crusher", "JM Press", "Close-Grip Bench Press",
    "Bench Dip", "Triceps Dip", "Machine Triceps Extension", "Dumbbell Kickback", "Cable Kickback", "Diamond Push-up",
  ],
  "Ön kol": ["Wrist Curl", "Reverse Wrist Curl", "Reverse Curl", "Dead Hang"],
  "Quadriceps": [
    "Front Squat", "Hack Squat", "Pendulum Squat", "Belt Squat", "Smith Machine Squat", "Goblet Squat", "Safety Bar Squat",
    "V-Squat", "Leg Extension", "Single-Leg Leg Extension", "Single-Leg Leg Press", "Bulgarian Split Squat", "Walking Lunge",
    "Reverse Lunge", "Step-up", "Sissy Squat",
  ],
  "Hamstring": [
    "Lying Leg Curl", "Seated Leg Curl", "Standing Leg Curl", "Nordic Curl", "Stiff-Leg Deadlift", "Dumbbell Romanian Deadlift",
    "Single-Leg Romanian Deadlift", "Good Morning", "Glute-Ham Raise",
  ],
  "Kalça": [
    "Hip Thrust", "Machine Hip Thrust", "Smith Machine Hip Thrust", "Glute Bridge", "Cable Glute Kickback", "Hip Abduction Machine",
    "Hip Adduction Machine", "Cable Pull-Through", "Reverse Hyperextension", "Sumo Deadlift",
  ],
  "Baldır": [
    "Standing Calf Raise", "Seated Calf Raise", "Leg Press Calf Raise", "Smith Machine Calf Raise", "Donkey Calf Raise",
    "Single-Leg Calf Raise", "Tibialis Raise",
  ],
  "Karın": [
    "Cable Crunch", "Rope Crunch", "Crunch", "Machine Crunch", "Hanging Leg Raise", "Hanging Knee Raise", "Captain's Chair Leg Raise",
    "Lying Leg Raise", "Ab Wheel Rollout", "Plank", "Side Plank", "Russian Twist", "Pallof Press", "Decline Sit-up",
    "Cable Woodchopper", "Dead Bug", "Dragon Flag",
  ],
  "Tüm vücut": ["Farmer's Walk", "Kettlebell Swing", "Power Clean", "Clean and Jerk", "Snatch", "Thruster", "Sled Push", "Burpee"],
};
// the first 15 starter exercises move from the old broad groups to the finer ones
const SEED_GROUPS = {
  "ex-squat": "Quadriceps", "ex-rdl": "Hamstring", "ex-leg_press": "Quadriceps", "ex-curl": "Biceps",
  "ex-triceps_pd": "Triceps", "ex-leg_curl": "Hamstring", "ex-calf_raise": "Baldır",
};
