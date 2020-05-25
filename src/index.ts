import * as core from '@actions/core'
import { GitHub } from '@actions/github'
import { context } from '@actions/github'

function IsValidJson(str: string): boolean {
    try {
        JSON.parse(str)
    } catch (e) {
        return false
    }
    return true
}

function NormalizeResponse(names: string[], check_runs: {id: number; name: string; status: string; conclusion: string;}[]): string[] {
    var response_statuses: string[] = []
    var data = check_runs.map(element => {
        return {
            id: element.id,
            name: element.name,
            status: element.status,
            conclusion: element.conclusion
        }
    });

    for (var i = 0; i < names.length; ++i) {
        var found = false;
        data = data.filter(item => {
            if (!found && item.name == names[i]) {
                response_statuses.push(item.status);
                found = true;
                return false;
            }
            return true;
        })
    }

    return response_statuses
}

async function wait_for(milliseconds: number): Promise<void> {
    return new Promise(function (resolve, reject) {
        if (isNaN(milliseconds) || milliseconds <= 0) {
            reject('Invalid time')
            return
        }
        
        setTimeout(() => { resolve() }, milliseconds)
    })
}

async function check(token: string, owner: string, repo: string, ref: string, names: [string], statuses: [string], poll_interval: number, timeout: number): Promise<any> {
    let now = new Date().getTime()
    const expiredTime = new Date().getTime() + (timeout * 1000);
    const client = new GitHub(token)

    while (now <= expiredTime) {
        const response = await client.checks.listForRef({
            owner: owner,
            repo: repo,
            ref: ref
        })

        if (response.data.total_count >= names.length) {
            const check_runs = response.data.check_runs.filter(item => {
                return names.find(element => element == item.name)
            })

            const result = check_runs.map(element => {
                return {
                    id: element.id,
                    name: element.name,
                    status: element.status,
                    conclusion: element.conclusion
                }
            })

            console.log(`Retrieved: ${ JSON.stringify(result.map(item => { return { name: item.name, status: item.status } })) }`);
            
            if (statuses.length > 0) {
                const response_statuses = NormalizeResponse(names, check_runs)
                const did_all_complete = response_statuses.length === statuses.length && response_statuses.every((value, index) => {
                    return value === statuses[index]
                })
                
                if (did_all_complete) {
                    console.log('All check-runs are completed.')
                    return result
                }
            }
            else {
                const response_statuses = NormalizeResponse(names, check_runs)
                const did_all_complete = response_statuses.every(value => {
                    return value === "completed"
                })
                
                if (did_all_complete) {
                    console.log('All check-runs are completed.')
                    return result
                }
            }
        }
        
        console.log(`Time Remaining: ${ (expiredTime - now) / 1000 }`)
        console.log(`Waiting for: ${ poll_interval }s before trying again.`)

        await wait_for(poll_interval * 1000)
        now = new Date().getTime()
    }
    return null
}

async function main(): Promise<void> {
    try {
        let raw_names = core.getInput('check_names', { required: true })
        if (raw_names != null && typeof raw_names === 'string' && !IsValidJson(raw_names)) {
            raw_names = `[${ raw_names }]`
        }

        if (raw_names == null) {
            raw_names = '[]'
        }

        if (!IsValidJson(raw_names)) {
            core.setFailed('ERROR: check_names must be an array of strings.')
            return
        }

        let raw_statuses = core.getInput('statuses', { required: false })
        if (raw_statuses != null && typeof raw_statuses === 'string' && !IsValidJson(raw_statuses)) {
            raw_statuses = `[${ raw_statuses }]`
        }

        if (raw_statuses == null) {
            raw_statuses = '[]'
        }

        if (!IsValidJson(raw_statuses)) {
            core.setFailed('ERROR: statuses must be an array of strings.')
            return
        }

        const token = core.getInput('github_token', { required: true })
        const check_names = JSON.parse(raw_names)
        const statuses = JSON.parse(raw_statuses)
        const owner = core.getInput('owner') || context.repo.owner
        const repo = core.getInput('repo') || context.repo.repo
        const ref = core.getInput('ref') || context.ref
        const timeout = parseInt(core.getInput('timeout') || '300')
        const poll_interval = parseInt(core.getInput('poll_interval') || '10')

        if (!Array.isArray(check_names) || check_names.length <= 0 || !check_names.every(item => typeof item === 'string')) {
            core.setFailed('ERROR: check_names must be an array of strings.')
            return
        }

        if (!Array.isArray(statuses) || !statuses.every(item => typeof item === 'string')) {
            core.setFailed('ERROR: statuses must be an array of strings.')
            return
        }

        if (statuses.length > 0 && statuses.length != check_names.length) {
            core.setFailed('ERROR: amount of statuses do not match amount of check_names.')
            return
        }

        const result = await check(
            token,
            owner,
            repo,
            ref,
            check_names as [string],
            statuses as [string],
            poll_interval,
            timeout
        )

        if (result == null) {
            core.setFailed('ERROR: timed-out.')
            return
        }

        core.setOutput('result', JSON.stringify(result))
    } catch (error) {
        core.setFailed(error.message)
    }
}

main()