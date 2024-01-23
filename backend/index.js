import express from "express";
import cors from "cors"
import { Octokit } from "octokit";
import 'dotenv/config';
import bcrypt from "bcrypt"
import { createClient } from '@supabase/supabase-js'

// maybe you can do some sort of stats comparison app? or leaderboard or something?
// i'm thinking you can query for people's profiles and pull stats around num of lines added/deleted, num of commits, avg commit frequency, etc
// and then compare 2 (or multiple) profiles and see how they match up
// and you could have different leaderboards for different stats
// with all these stats, you could also look into some visualizing tools/packages to spice things up rather than just displaying text

//octokit simplifies github api calls
const octokit = new Octokit({ auth: process.env.AUTH_KEY });

//supabase db server hosting
const supabaseUrl = 'https://btsemxwskradoknjgqau.supabase.co'
const supabaseKey = process.env.SUPABASE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

//config express
const port = 8080
const app = express()
app.use(cors())
app.use(express.json()) 
app.use(express.urlencoded({ extended: true }))

app.get("/", (req, res) => {
    res.json("Hello")
})


app.post("/compare", async (req, res) => {
    const {user1, user2} = req.body
    const resArray = []
    const userz1Data = await userStats(user1)
    const userz2Data = await userStats(user2)
    resArray.push(userz1Data)
    resArray.push(userz2Data)
    res.json(resArray)
})

app.post("/user", async (req, res) => {
    const {username} = req.body
    const userz1Data = await userStats(username)
    res.json(userz1Data)
})



app.post("/repos", async (req, res) => {
    //gets a list of repo names from the user
    const user = req.body.user1
    if (user === ""){
        res.json("Error")
        return
    }
    
    
    const user1Repos = await octokit.request("GET /users/{username}/repos", {
        username: user,
        headers: {
            'X-GitHub-Api-Version': '2022-11-28'
        }
    })
    
    const resData = []
    user1Repos.data.forEach(repo => {
        resData.push(repo.name)
    })
    res.json(resData)
})

app.post("/repoInfo", async (req, res) => {
    const {user1, repo} = req.body
    
    //get bytes per language
    const repoLanguages = await octokit.request('GET /repos/{owner}/{repo}/languages', {
        owner: user1,
        repo: repo,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28'
        }
    })
    
    //get all commmits and then get lines added and deleted per commit
    const userCommits = await octokit.request('GET /repos/{owner}/{repo}/commits', {
        owner: user1,
        repo: repo,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28'
        }
    })
    const commitShas = []
    userCommits.data.forEach((commit) => {
        commitShas.push(commit.sha)
    })
    var currLines = 0
    const linesArray = []
    var z = 0
    for (let i = commitShas.length - 1; i > -1; i--){
        z += 1
        const currSha = commitShas[i]
        const response = await octokit.request('GET /repos/{owner}/{repo}/commits/{sha}', {
            owner: user1,
            repo: repo,
            sha: currSha,
            headers: {
              'X-GitHub-Api-Version': '2022-11-28'
            }
        })
        const change = response.data.stats.additions - response.data.stats.deletions
        if (i === commitShas.length - 1){
            linesArray.push(change)
        } else {
            const prevLines = linesArray[z - 2]
            const newTotal = prevLines + change
            linesArray.push(newTotal)
        }
    }

    const repoInfoResponse = await octokit.request('GET /repos/{owner}/{repo}', {
        owner: user1,
        repo: repo,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28'
        }
    })

    const repoInfo = {
        forks: repoInfoResponse.data.forks,
        stars: repoInfoResponse.data.stargazers_count,
        openIssues: repoInfoResponse.data.open_issues,
    }

    const resData = {
        languages: repoLanguages.data,
        lineNums: linesArray,
        info: repoInfo
    }

    
    res.json(resData)
})

app.post("/login", async (req, res) => {
    const {username, password} = req.body
    try {
        const { data, error } = await supabase
            .from('users')
            .select()
            .eq('username', username)

        bcrypt.compare(password, data[0].hashed_password, function(err, result) {
        if (result) {
            res.json({id: data[0].id, username: username })
        } else {
            res.send("Wrong")
        }
    });
    } catch {
        res.send("None")
    }
    

    
})


app.post("/register", async (req, res) => {
    const {username, password} = req.body
    //check if username already in use
    const { data, error } = await supabase
        .from('users')
        .select()
        .eq('username', username)
    if (data.length > 0) {
        res.send("Username")
    } else {
        //hash password with bcrypt
        const saltRounds = 10
        bcrypt.genSalt(saltRounds, async function(err, salt) {
            bcrypt.hash(password, salt, async function(err, hash) {
                const { error } = await supabase
                    .from('users')
                    .insert({ username: username, hashed_password: hash })
                    console.log(error)
                    if (error) {
                        res.send("Error")
                    } else {
                        res.send("Success")
                    }
            });
        });  
    }

    
})

app.listen(port, () => {
    console.log("listening on port 8080")
});

//takes in a username and returns an object with desired info
async function userStats(username){
    //get all their repositories
    const user1Repos = await octokit.request("GET /users/{username}/repos", {
        username: username,
        headers: {
            'X-GitHub-Api-Version': '2022-11-28'
        }
    })
    var user1stars = 0
    var user1OpenIssues = 0
    var user1TotalBytes = 0
    user1Repos.data.forEach((repo) => {
        const openIssue = repo.open_issues
        const bytes = repo.size
        const stars = repo.stargazers_count
        user1OpenIssues += openIssue
        user1TotalBytes += bytes
        user1stars += stars
    })

    //calculate languages
    const languageDict1 = {}
    for (let i = 0; i < user1Repos.data.length; i++){
        const repoName = user1Repos.data[i].name
        const user1Languages = await octokit.request('GET /repos/{owner}/{repo}/languages', {
            owner: username,
            repo: repoName,
            headers: {
              'X-GitHub-Api-Version': '2022-11-28'
            }
        })
        
        for (var key in user1Languages.data){
            if (key in languageDict1){
                languageDict1[key] = languageDict1[key] + user1Languages.data[key]
            } else {
                languageDict1[key] = user1Languages.data[key]
            }
        }
    }
    
    //calculate commits
    var user1commits = 0
    for (let i = 0; i < user1Repos.data.length; i++){
        const repoName = user1Repos.data[i].name
        const user1commitsResponse = await octokit.request('GET /repos/{owner}/{repo}/commits?author={owner}', {
            owner: username,
            repo: repoName,
            headers: {
              'X-GitHub-Api-Version': '2022-11-28'
            }
        })
        user1commits += user1commitsResponse.data.length
    }
    
    //calculate pulls
    var user1PullRequests = 0
    for (let i = 0; i < user1Repos.data.length; i++){
        const repoName = user1Repos.data[i].name
        const user1PullsResponse = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
            owner: username,
            repo: repoName,
            headers: {
              'X-GitHub-Api-Version': '2022-11-28'
            }
        })
        user1PullRequests += user1PullsResponse.data.length
    }
    
    const user1Data = {
        user: username,
        stars: user1stars,
        commits: user1commits,
        prs: user1PullRequests,
        repoCount: user1Repos.data.length,
        openIssues: user1OpenIssues,
        totalBytes: user1TotalBytes,
        languageDict: languageDict1,
    }
    
    return user1Data


}