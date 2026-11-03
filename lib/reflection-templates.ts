/**
 * Ready-made self-reflection templates a teacher can start a REFLECTION test
 * from, instead of typing the criteria in. Each item is one box the candidate
 * writes in; `section` is the heading it sits under.
 */
export type TemplateCriterion = { section: string; question: string }

/** The Level 6 "Candidate self evaluation and reflection" form. */
export const LEVEL_6_TEMPLATE: TemplateCriterion[] = [
  {
    section: "The assessment",
    question: "Description: which assessment this was (informal 1-1 discussion, informal group debate or formal group meeting), the topic, and how many people took part",
  },

  { section: "1.1 Initiate and develop discourse", question: "a. Contribute spontaneously to develop or challenge arguments" },
  { section: "1.1 Initiate and develop discourse", question: "b. Respond to and give instructions and advice" },
  { section: "1.1 Initiate and develop discourse", question: "c. Respond to and make requests and enquiries" },
  { section: "1.1 Initiate and develop discourse", question: "d. Make and discuss proposals and suggestions" },
  { section: "1.1 Initiate and develop discourse", question: "e. Include newcomers and set people at ease" },

  { section: "1.2 Make inferences about opinions, attitudes and feelings", question: "a. Distinguish and express opinions and attitudes" },
  { section: "1.2 Make inferences about opinions, attitudes and feelings", question: "b. Infer and describe feelings and emotions" },
  { section: "1.2 Make inferences about opinions, attitudes and feelings", question: "c. Respond to and convey humour, sarcasm and ambiguity" },

  { section: "1.3 Adapt own language appropriately to the situation (essential criteria)", question: "a. Use appropriate style and register" },
  { section: "1.3 Adapt own language appropriately to the situation (essential criteria)", question: "b. Use culturally appropriate signed and non-verbal turn-taking conventions" },

  { section: "2.1 Maintain fluency, grammatical accuracy and coherence (essential criteria)", question: "a. Understand and use all verb forms and sentence structures" },
  { section: "2.1 Maintain fluency, grammatical accuracy and coherence (essential criteria)", question: "b. Use all ways to link concepts and to support pace, clarity and cohesion" },

  { section: "2.2 Understand and use an extensive range of complex vocabulary (essential criteria)", question: "a. Understand and use all regional and standard varieties" },
  { section: "2.2 Understand and use an extensive range of complex vocabulary (essential criteria)", question: "b. Understand and use colloquial and idiosyncratic language" },
  { section: "2.2 Understand and use an extensive range of complex vocabulary (essential criteria)", question: "c. Understand and use a wide range of technical language" },
  { section: "2.2 Understand and use an extensive range of complex vocabulary (essential criteria)", question: "d. Understand and use complex language to discuss numerical and statistical information" },
  { section: "2.2 Understand and use an extensive range of complex vocabulary (essential criteria)", question: "e. Use paraphrase effectively, including when a sign is not known" },

  // Numbered "4" on the form, after 2.2.
  { section: "4 Use reference sources", question: "a. Use reference sources to confirm or clarify the meaning of signs" },
]
