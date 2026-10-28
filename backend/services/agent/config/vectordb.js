import { QdrantVectorStore } from "@langchain/qdrant";
import { QdrantClient } from "@qdrant/js-client-rest";
import { embeddings } from "./embedding.js";
import crypto from "crypto"
import dotenv from "dotenv";
dotenv.config();

export const client=new QdrantClient({
  url:process.env.QDRANT_URL,
  apiKey:process.env.QDRANT_API_KEY,
  checkCompatibility:false
})

const toSparse=(text)=>{
  const map={}
  (text.toLowerCase().match(/\w+/g) || []).forEach(w=>{
    const hash=w.split("").reduce((a,c)=>(a*31 +c.charCodeAt(0)) >>> 0 , 0) % 2147483647;
    map[hash]=(map[hash] || 0) +1;
  });
  const indices=Object.keys(map).map(Number).sort((a,b)=>a-b);
  return {indices  ,values:indices.map(i=>map[i])};
}

export const vectorStore= async (docs,collectionName)=>{
  const texts=docs.map(d=>d.pageContent);
  const dense=await embeddings.embedDocuments(texts)


  await client.createCollection(collectionName,{
    vectors:{dense: {size: dense[0].length,distance:"Cosine"}},
    sparse_vectors:{sparse:{}}
  })

  await client.upsert(collectionName,{
    wait:true,
    points:docs.map((d,i)=>({
      id:crypto.randomUUID(),
      vector:{dense:dense[i],sparse:toSparse(d.pageContent)},
      payload:{pageContent:d.pageContent}
    }))
  })

  return {
    hybridSearch:async(query,limit=5)=>{
      const qDense=await embeddings.embedQuery(query);
      const qSparse=toSparse(query)

      const [denseHits,sparseHits]=await Promise.all([
        client.search(collectionName,{vector:{name:"dense",vector:qDense},limit,with_payload:true}),
        client.search(collectionName,{vector:{name:"sparse",vector:qSparse},limit,with_payload:true}),
      ]);

      const map=new Map();
      [...sparseHits,...denseHits].forEach(r=>map.set(r.id,r.payload));
      return Array.from(map.values()).slice(0,limit);
    
    }
  }
}

