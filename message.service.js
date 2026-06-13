
class MessageService {

 detectIntent(message) {
     const text = message.toLowerCase();
   
     if (
       text.includes("cv") &&
       (text.includes("analyse") || text.includes("analyser"))
     ) {
       return "CV_ANALYSIS";
     }
   
     if (
       text.includes("offre") ||
       text.includes("emploi") ||
       text.includes("poste") ||
       text.includes("job")
     ) {
       return "JOB_SEARCH";
     }
   
     return "GENERAL";
   }

}

export default MessageService