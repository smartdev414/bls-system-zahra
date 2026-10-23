-- Written questions: how many marks each is worth (null = 3, as before).
ALTER TABLE "QuizQuestion" ADD COLUMN "maxMarks" INTEGER;

-- Vocabulary tests: practised sign → word, word → sign, or both ways.
CREATE TYPE "VocabularyMode" AS ENUM ('PICK_WORD', 'SIGN_IT', 'BOTH');
ALTER TABLE "Test" ADD COLUMN "vocabularyMode" "VocabularyMode" NOT NULL DEFAULT 'PICK_WORD';
