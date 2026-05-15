import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req,res){

try {

const token = req.headers["x-admin-token"];

if(token !== process.env.ADMIN_TOKEN){
return res.status(401).json({error:"Unauthorized"});
}

const { id } = req.query;

if(!id){
return res.status(400).json({error:"Missing inspection id"});
}

const { data, error } =
await supabase
.from("inspections")
.select(`
*,
properties(*)
`)
.eq("id",id)
.single();

if(error) throw error;

return res.status(200).json(data);

}

catch(err){

return res.status(500).json({
error:err.message
});

}

}
