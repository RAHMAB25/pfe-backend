import SkillsService from "./skills.service.js";

class JobOfferService {

  skillsService = new SkillsService()

  getMatchingJobs(cvText, offresResult,) {

    const userSkills = this.skillsService.extractSkills(cvText);
  
    const jobs = offresResult.rows;
  
    return this.findMatchingJobs(userSkills, jobs);
  }

  findMatchingJobs(cvSkills, jobs) {

    return jobs
      .map(job => ({
        ...job,
        score: this.scoreJob(
          cvSkills,
          job.description
        )
      }))
      .sort((a, b) => b.score - a.score)
      .filter(job => job.score > 0);
  }
  
  scoreJob(cvSkills, jobDescription) {
    const desc = jobDescription.toLowerCase();
  
    let score = 0;
  
    for (const skill of cvSkills) {
      if (desc.includes(skill.toLowerCase())) {
        score++;
      }
    }
  
    return score;
  }

  calculateMatchScore(cvSkills, jobDescription) {
    const desc = jobDescription.toLowerCase();
    
    const allSkills = this.skillsService.skills;
  
    const requiredSkills = allSkills.filter(skill =>
      desc.includes(skill.toLowerCase())
    );
  
    if (requiredSkills.length === 0) {
      return 0;
    }
  
    const cvSet = new Set(
      cvSkills.map(skill => skill.toLowerCase())
    );
  
    const matchedSkills = requiredSkills.filter(skill =>
      cvSet.has(skill.toLowerCase())
    );
  
    return Math.round(
      (matchedSkills.length / requiredSkills.length) * 100
    );
  }

}

export default JobOfferService;