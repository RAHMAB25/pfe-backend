class SkillsService {
 skills = [
  "java",
  "spring",
  "spring boot",
  "react",
  "nodejs",
  "docker",
  "kubernetes",
  "sql",
  "postgresql",
  "aws",
  "marketing"
 ];

  extractSkills(cvText) {
   const lower = cvText.toLowerCase();

   return this.skills.filter(skill =>
    lower.includes(skill.toLowerCase())
   );
  }

}
export default SkillsService;