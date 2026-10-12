// Exercise instruction parsing through the retained voice-correction workflow.
export async function instruction(page){
 let corrected=page.getByLabel('Corrected instruction',{exact:true});if(await corrected.count())return corrected;
 if(!await page.locator('[data-review-item]').count())await page.evaluate(()=>{const lib=JSON.parse(localStorage.getItem('shottime.notes'));ShotNotesUI.receiveVoice(JSON.stringify({available:false,id:'test-review-'+crypto.randomUUID(),listId:lib.selectedListId,state:'stopped',uncertain:true,events:[{text:'CN-1 has'}]}));});
 await page.getByRole('button',{name:'Edit wording instead',exact:true}).click();return page.getByLabel('Corrected instruction',{exact:true});
}
export async function undoLast(page){await page.evaluate(()=>{const lib=JSON.parse(localStorage.getItem('shottime.notes'));ShotNotesUI.receiveVoice(JSON.stringify({available:false,id:'test-undo-'+crypto.randomUUID(),listId:lib.selectedListId,state:'stopped',events:[{text:'Undo that'}]}));});}
export async function confirmDuplicate(page){const add=page.getByRole('dialog',{name:'Duplicate CN#',exact:true}).getByRole('button',{name:'Add anyway',exact:true});if(await add.count())await add.click();}
export async function submitInstruction(page,acceptDuplicate=true){const apply=page.getByRole('button',{name:'Apply correction',exact:true});await (await apply.count()?apply:page.getByRole('button',{name:'Add instruction',exact:true})).click();if(acceptDuplicate)await confirmDuplicate(page);}
export async function exposePipe(row){const card=row.locator('xpath=ancestor::details[@data-pipe-card]');if(!await card.evaluate(e=>e.open))await card.locator('summary').first().click();return row;}
export async function beginJob(page){
 await page.getByRole('button',{name:'Create job',exact:true}).click();
 await page.getByLabel('Client name',{exact:true}).fill('Test job');
}
export async function finishJob(page){
 await page.getByRole('button',{name:'Save job',exact:true}).click();
 await page.getByRole('button',{name:'Add daily list',exact:true}).click();
 await page.getByRole('button',{name:'Create daily list',exact:true}).click();
}
